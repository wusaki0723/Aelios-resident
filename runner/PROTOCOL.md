# runner ↔ 云端协议 `aelios-runner/1`

这是 runner 和住户（Worker）之间的协议。云端那一半还没写，runner 现在只对着 `test/fake-cloud.mjs` 测。
它不复用旧的 `/desktop/v1`。想法借自 agent-autoloop 的接单协议：只往外连、领活幂等、每份活一个 token、回执可重放、回执里带 ask / notice / resolve。

## 原则

1. runner 只往外连，不开端口。云端够不到 runner，所以"给线程说话"也是云端放一条消息、runner 来取。
2. 活是**发给线程的消息**。线程 = 一个 ACP 会话 = 一个固定工作目录。消息有四种：`job`、`say`、`mail`、`cancel`。
3. 云端只给文字和线程号。**用哪个帮手、在哪个目录、什么权限，只由 runner 本机配置决定。** 消息里多出来的字段（`cwd`、`agent`、`command`……）一律不看。`access` 只能把权限往下调，不能往上加。
4. 领活幂等：同一个 `claimKey` 重来，拿回同一份活。
5. 每份活有自己的 `token`，只对这份活有效。回执带 `workId` + `token`。
6. 回执带 `receiptId`，可重放：内容相同返回 `duplicate`，内容不同返回 409。
7. 帮手不知道用户是谁：云端写进 `text` / `instruction` 的内容里不放用户的名字和人设。runner 原样转给帮手，不加任何东西。

## 地址

住户是 `default` 时前缀为空，否则是 `/r/<id>`。下面写 `{P}`。

| 地址 | 谁调用 | 凭据 |
|---|---|---|
| `POST {P}/web/runner/register` `{label}` → `{runnerId, token, protocol}` | 配对时调一次 | 请求头 `x-web-key` |
| `POST {P}/web/runner/revoke` `{runnerId}` → `{ok}` | 解除配对 | 请求头 `x-web-key` |
| `POST {P}/runner/v1/heartbeat` | runner，每个周期一次 | `Authorization: Bearer <token>` |
| `POST {P}/runner/v1/poll` | runner | 同上 |
| `POST {P}/runner/v1/receipt` | runner | 同上 |

请求体是 JSON 对象，每个请求最多 16 KB。出错时返回 `{error, code}` 加状态码。
- 401 `UNAUTHORIZED`：配对被撤销。runner 停止领活。
- 409 `INVALID_TOKEN` / `UNKNOWN_WORK`、400：这条回执永远不会被收，runner 丢掉它。
- 429、5xx、连不上：runner 留着，下个周期重发。

一个住户同时有几个 runner，由云端定；runner 只认自己的 token。

## heartbeat

```jsonc
// 请求
{ "plugin": "kiro", "busy": "thread-id 或 null" }
// 响应
{ "ok": true, "protocol": "aelios-runner/1" }
```

云端凭它判断"在线"，并给 runner 手里还没交回执的活续租（5 分钟）。租约过期的活云端标成"状态待确认"，**不会重新派**。

## poll：领活

```jsonc
// 请求
{ "claimKey": "ck_…", "accept": ["job", "say", "mail", "cancel"] }
// 响应
{ "work": null }
{ "work": { /* Work，见下 */ } }
```

- `claimKey` 是 runner 每次领活前生成并存盘的随机串。同一个 `claimKey` 再来，云端返回**同一份** work（响应丢了也不丢活）。拿到活并存盘后，runner 才换新的 `claimKey`。
- `accept` 是这次愿意收的消息种类。runner 空闲时收全部；正在跑一轮、或本机队列里还有活时，只收 `say`、`mail`、`cancel`（所以不会同时跑两个新 job）。云端只能返回种类在 `accept` 里的 work，同一线程里的消息按放入顺序给。

### Work

```jsonc
{
  "workId": "w_…",          // 1 到 64 位：字母、数字、_ . : -
  "token": "wt_…",          // 这份活的专用凭据
  "thread": "t_…",          // 线程号：一个线程对应一个 ACP 会话
  "kind": "job",            // job | say | mail | cancel
  "title": "…",             // 可选，只给日志，不给帮手
  "text": "…",              // job / say / mail 的正文，最多 16000 字
  "access": "read",         // 可选：read | edit | full。只能比本机配置低
  "interrupt": true         // 仅 say：默认 true
}
```

| kind | 来源 | runner 怎么做 |
|---|---|---|
| `job` | 住户派活 | 排进队，轮到时发给该线程的 ACP 会话（没有就新开）。 |
| `say` | 用户直接对线程说话（**停下重来**） | `interrupt` 为 true（默认）：线程正在跑就先 `session/cancel`，被打断的那份活交 `cancelled`，然后马上把这句话发进**同一个**会话。线程空闲就直接发。`interrupt:false` 当 `mail`。回话不经住户转述：这份活的回执就是线程自己的话。 |
| `mail` | 住户往线程的信箱投信（**排队**） | 不打断。线程在跑就排在后面，先交一个 `queued` 回执；跑完当前一轮再按顺序发进同一个会话。 |
| `cancel` | 停下，不再接着做 | 取消该线程正在跑的一轮，并丢掉它本机队列里还没跑的活（各交一份 `cancelled`）。这份 `cancel` 自己交 `done`。 |

## receipt：回执

```jsonc
{
  "receiptId": "w_…:final",   // 同一份内容永远同一个 id；runner 用 "<workId>:<type>"
  "workId": "w_…",
  "token": "wt_…",
  "type": "started",          // started | queued | final
  "sessionId": "…",           // 可选，ACP 会话号（不透明，最多 160 位；过不了校验就换成短摘要）
  // 只有 final 带下面这些：
  "status": "done",           // done | failed | needs_you | cancelled
  "summary": "…",             // 最多 4000 字，已去掉本机路径和凭据
  "ask":    { "key": "…", "question": "…", "options": ["…"], "recommend": "…" },
  "notice": { "text": "…", "fyi": true },
  "resolve": ["key", "…"]
}
```

- `started`：帮手会话已经建好或接回，开始跑。`queued`：这封 `mail` 排在后面了。`final`：这份活到头了，一份活只有一个 `final`。
- `status` 的意思：`done` 做完；`failed` 没做成（帮手报错）；`needs_you` 需要用户拍板，**必带 `ask`**；`cancelled` 被 `say` 打断或被 `cancel` 停下。
- **`ask`** 是"等咲咲"列表里的一项。`key` 是同一件事的稳定编号：同一个 `key` 开着就不重复问。云端把它列进"等你"，不刷聊天。`options` 和 `recommend` 可选。
- **`notice`** 只告知；`fyi:true` 表示不需要回应。
- **`resolve`** 是 `key` 的列表：这些问题现在自己好了（用户回答了，或后续一轮已经做完），云端把对应的卡片收掉。runner 在某个线程做完（`done`）后，把这个线程还开着的 `ask` 全部放进 `resolve`。
- 同一个 `receiptId` 重发：内容一样返回 `{ok:true, duplicate:true}`，不一样返回 409 `RECEIPT_CONFLICT`。
- 已交过 `final` 的活，再来别的内容的 `final` 返回 409 `TERMINAL_CONFLICT`；租约过期后迟到、`token` 对得上的 `final` 仍然收下（对账）。

回执写进本机的待发队列（outbox）再发，所以断线、重启都不会丢，也不会因为重发而让帮手再做一遍：runner 的"领到过的活"和"交过的回执"都落盘，重启后遇到还没有 `final` 的在跑的活，交 `needs_you`（"状态待确认，不会自动重做"），不会重跑。

## runner 的本机规则（不在协议里，但云端要知道）

- 每个线程固定一个工作目录，第一次用时定下，之后不变。
- 权限请求（`session/request_permission`）按档位自动答：`read` 只许读/搜索；`edit` 加工作目录里的编辑；`full` 都许。只选"只这一次"，不留长期许可。被拒的请求会让这一轮交 `needs_you`，`ask` 里写明被拒的是什么。
- 帮手的最后一条消息以问号结尾，也交 `needs_you`，`ask.question` 是那段话。
- 帮手的输出和仓库里的文字都只是数据：它们不能决定派给谁、在哪个目录、用什么权限。
