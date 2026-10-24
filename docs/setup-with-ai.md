# 让 AI 帮你装好住户

这份说明是写给 AI 看的。你用 Claude Code、Codex、Cursor 这类能跑命令的 AI，把下面这段话发给它就行：

```text
帮我装好、配好 Aelios-resident（住在我 Cloudflare 账号里的 AI 伴侣）。先读 https://raw.githubusercontent.com/wusaki0723/Aelios-resident/main/docs/setup-with-ai.md ，照着做。需要我在浏览器里点、或者需要我自己填 key 的时候，停下来告诉我去哪儿填。
```

从零开始也行，已经装过、只想配好的也行。装完你会有：

- 一个 Telegram bot，私聊它就是在跟住户说话；
- 一个网页门（地址加一把网页钥匙），在 Telegram 里也能当 Mini App 打开，跟 Telegram 是同一段对话；
- 接了 Aelios 的话，它记得以前的事，跟你在别处用 Aelios 的 AI 用同一份记忆。

你要准备的：一个 Cloudflare 账号（免费的就够），一个 Telegram 账号。想要长期记忆的话，再要一个 Aelios，没有也没关系，AI 会先帮你装。想用 Claude 聊的话，要一把 Anthropic 的 API key；什么 key 都没有也能先用免费的默认模型聊。

你自己要动手的只有这几件：在 Telegram 里找 @BotFather 建一个 bot；把 bot 的 token 填进 Cloudflare 后台，token 不经过 AI；在浏览器里点「允许」，让 AI 登录 Cloudflare。用自己的模型 key 的话，key 也是你自己存进 Cloudflare 后台。其余的，包括部署、生成钥匙、接 Telegram、接 Aelios、选模型、填设置，都交给 AI。

---

## 给 AI：先守这几条

- 用用户的语言跟用户说话。每一步先用一句话说你要做什么。
- **别让用户把凭证贴进对话**：Telegram bot 的 token、模型厂商的 key、Cloudflare 的令牌、GitHub 的令牌都不行。bot token 由用户自己存进 Cloudflare（第 4 步），厂商的 key 也由用户自己存（第 7 步）。例外有两个：网页钥匙 `WEB_KEY` 是你生成、本来就要交给用户的；Aelios 的钥匙 `CHATBOX_API_KEY` 本来就要填进用户的客户端，用户愿意给你就收，不愿意就请用户自己在设置页填。
- **你手上已经有用户的 key 的**（在环境变量里，或者在你自己的配置里，比如搜索、语音那几家的），用户同意用在住户上，就照第 10 步的写法从那里直接填，别把值打印出来、别写进文件。没有的就请用户自己在网页设置页填。
- **你生成的 `TG_WEBHOOK_SECRET` 别打印、别写进文件**，用管道直接存进 Worker（第 4 步的命令就是这么写的）。
- **没经用户同意，别删、别换已有的东西**：已经在跑的住户 Worker 和它的 Secret（聊天记录、人设、表情包都存在 Worker 里）、Aelios 里已配好的身份、AI Gateway、存好的厂商 key 都不行。换 `WEB_KEY` 也要先问，换了以后旧钥匙就进不去了。
- 部署只用 `npm run deploy`。**别改 `wrangler.jsonc` 的 `name`，别往里加 `vars`**：写在文件里的值每次部署都会冲掉网页上的设置。设置一律用第 5 步的接口填。
- 卡住了别换着法子硬试。把报错原文和你的判断告诉用户，问下一步。

下面的命令里：

- `<住户地址>` 是住户的网址，形如 `https://aelios-resident.<子域>.workers.dev`，第 2 步部署完拿到。
- `<网页钥匙>` 是第 3 步生成的 `WEB_KEY`。
- `<Aelios 地址>`、`<Aelios 钥匙>` 是用户的 Aelios Worker 地址（形如 `https://companion-memory-proxy.<子域>.workers.dev`）和它的 `CHATBOX_API_KEY`。

## 0. 先问用户

1. **以前装过住户吗？**
   - 没装过：从第 1 步往下全做。
   - 装过：要住户的地址和网页钥匙。用 `curl -s <住户地址>/web/check -H "x-web-key: <网页钥匙>"` 试一下，返回 `"ok":true` 就跳过第 2、3 步；还没设 Telegram 的从第 4 步做，都设好了的从第 5 步做。用户忘了网页钥匙：先说清楚换了以后旧的就进不去，用户同意了再照第 3 步生成一把新的。
2. **有 Cloudflare 账号吗？** 没有就请用户先去 <https://dash.cloudflare.com/sign-up> 注册。有 GitHub 账号更好，用来 fork，以后更新点一下就行；没有也能装。
3. **要不要长期记忆（Aelios）？**
   - 已经有 Aelios：要 Aelios 地址，钥匙第 6 步再说。
   - 想要但还没装：先照 Aelios 的说明 <https://raw.githubusercontent.com/wusaki0723/Aelios/main/docs/setup-with-ai.md> 装好、配好（它的第 4 步会让用户存模型的 key），再回到这里。两边可以是同一个 Cloudflare 账号。
   - 不要：跳过第 6 步。住户照样能聊，只是不记得以前的事。
4. **用什么模型聊？** 按回答选路线：

   | 用户的情况 | 怎么走 |
   |---|---|
   | 接了 Aelios | 模型的 key 存在 Aelios 用的 AI Gateway 里（Aelios 说明第 4 步）。住户这边只选模型名，这个模型要在 Aelios 给住户的身份的主模型里（第 6 步） |
   | 没接 Aelios，有 Anthropic 或别家的 API key | 用户把 key 存进 AI Gateway `default` 的 Provider Keys（第 7 步），模型选 `anthropic/claude-…` 这类 |
   | 没接 Aelios，有中转站的地址和 key | 用户在设置页「供应商」里填中转地址和 key，模型写 `custom/<那家的模型名>`（第 7 步） |
   | 什么 key 都没有 | 先用默认的 `@cf/zai-org/glm-4.7-flash`，免费档就能用，以后再换 |
   | 只有 Claude 订阅（Pro、Max），没有 API key | 订阅变不成聊天用的 API。聊天先用免费模型或别家的 key；订阅可以给住户当手脚用（README「叫云端 Claude Code 干活」），装完再配 |

5. **用户的 Telegram 用户名**（`@` 开头），住户只回白名单里的人。用户没设用户名的话，第 9 步用日志查数字 id。
6. **用户在哪个时区？** 问城市就行，你换成 IANA 时区名，比如北京、上海写 `Asia/Shanghai`，香港写 `Asia/Hong_Kong`，东京写 `Asia/Tokyo`。不填默认是 `Asia/Singapore`。
7. **要它主动找你吗？** 要的话问什么时候，比如每天早上 9 点就是 `every day at 09:00`，工作日晚上就是 `every weekday at 21:30`。不要就不填。
8. **接了 Aelios 的：住户跟你在别处用 Aelios 聊的，是同一个 AI 吗？** 是：第 6 步用那个助手的身份。不是：第 6 步给住户新建一个身份，问这个 AI 叫什么名字、用户希望被怎么称呼。
9. **有没有现成的人设？** 有的话请用户给你（存成一个文件最方便），第 8 步你帮着填；不想给你就装完自己在网页上贴。

搜网、读网页、语音条、表情包、叫云端 Claude Code 干活这些，先不用问，装好能聊以后在第 10 步一项一项问。

## 1. 准备工具，登录 Cloudflare

```bash
node -v          # 要 22 或更高
git --version
gh auth status   # 有 gh 就用它 fork，没有也行
npx wrangler whoami
```

没登录就跑下面这条。先告诉用户：浏览器会打开 Cloudflare 的授权页，点「允许」就行。

```bash
npx wrangler login
```

你跑在远程机器、容器或云端沙盒里的话，用 `npx wrangler login --device`，把打印出来的网址和码交给用户，请用户在自己的浏览器里打开、确认。

`whoami` 列出不止一个账号时，问用户用哪个，之后每条 `wrangler` 命令前面都带上 `CLOUDFLARE_ACCOUNT_ID=<那个账号 ID>`。账号 ID 不是密钥，但也别写进仓库里的文件。

## 2. 部署（没装过才做）

```bash
gh repo fork wusaki0723/Aelios-resident --clone --default-branch-only
cd Aelios-resident
npm ci
npm run deploy
```

没有 gh：请用户打开 <https://github.com/wusaki0723/Aelios-resident> 点右上角 **Fork**，把 fork 的地址告诉你，你再 `git clone` 那个地址、`npm ci`、`npm run deploy`。用户没有 GitHub 账号就直接 `git clone https://github.com/wusaki0723/Aelios-resident`，只是以后更新要手动拉。

输出最后的 `https://aelios-resident.<子域>.workers.dev` 就是住户地址，记下来。Worker 的名字是 `aelios-resident`，同一个账号里已经有叫这个名字的 Worker 的话，先停下来问用户：那多半是用户以前装的住户，再部署会覆盖它的代码（聊天记录不会丢，但用户可能改过代码）。

常见卡点：

- **账号没有 workers.dev 子域**：请用户在后台打开一次 **Workers & Pages**，按提示选一个子域，再重跑 `npm run deploy`。
- **多个账号选不出来**：命令前带 `CLOUDFLARE_ACCOUNT_ID=<账号 ID>`。

验一下：

```bash
curl -s -o /dev/null -w "%{http_code}\n" <住户地址>/
curl -s <住户地址>/web/check
```

第一条是 `200`，第二条是 `unauthorized`（还没设网页钥匙），就是部署好了。新子域头一两分钟可能报 404 或连不上，等一会儿再试。

## 3. 网页钥匙 `WEB_KEY`

这是用户进网页门的钥匙，也是下面每一步你填设置用的钥匙。拿到它就能看全部对话、改所有设置。

生成一把，直接存进 Worker：

```bash
KEY="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))")" \
  && printf %s "$KEY" | npx wrangler secret put WEB_KEY >/dev/null \
  && echo "$KEY"
```

把钥匙告诉用户，请用户存进密码管理器，别截图、别外发。别把它写进任何文件。

过几秒验一下：

```bash
curl -s <住户地址>/web/check -H "x-web-key: <网页钥匙>"
```

返回 `{"ok":true,...}` 就对了。还是 `unauthorized` 的话等十几秒再试，新的 Secret 生效要一会儿。

## 4. 接上 Telegram

1. **用户建 bot**：请用户在 Telegram 里找 @BotFather，发 `/newbot`，照提示起名字和用户名，最后它会给一串 token。告诉用户：**这串 token 别发给你**。
2. **用户存 token**。两种办法，用户挑一个：
   - 在后台点：打开 <https://dash.cloudflare.com/?to=/:account/workers/services/view/aelios-resident/production/settings>（或者 **Workers & Pages** → `aelios-resident` → **Settings**）→ **Variables and Secrets** → **Add**，类型选 **Secret**，名字填 `TG_BOT_TOKEN`，值粘贴 token，**Deploy**。
   - 在用户自己的终端里（不是在跟你的对话里）：进到这个仓库的目录，跑 `npx wrangler secret put TG_BOT_TOKEN`，提示输入时粘贴 token、回车。
3. **你确认存上了**（只看名字，看不到值）：

   ```bash
   npx wrangler secret list
   ```

   里面有 `TG_BOT_TOKEN` 就往下做。
4. **你生成 webhook 的暗号、存进 Worker、接上 Telegram**，一条命令做完，暗号不打印：

   ```bash
   S="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))")" \
     && printf %s "$S" | npx wrangler secret put TG_WEBHOOK_SECRET >/dev/null \
     && for i in 1 2 3 4 5 6; do sleep 5; R="$(curl -s -X POST <住户地址>/tg/setup -H "x-tg-setup-secret: $S")"; case "$R" in *setWebhook*) break;; esac; done; \
     echo "$R"; unset S R
   ```

   返回里 `setWebhook`、`setMyCommands`、`setChatMenuButton` 都是 `"ok":true` 就接好了：bot 有了三个命令，左下角的菜单按钮会打开网页门。
   - 返回 `unauthorized`：新的暗号还没生效，整条命令再跑一次就行（会换一个新暗号，没关系）。
   - 返回 `set TG_BOT_TOKEN and TG_WEBHOOK_SECRET first`：token 没存上，回到第 2 小步。
   - `setWebhook` 报 `Unauthorized` 或 `Not Found`：bot token 不对，请用户在 @BotFather 里重新拿一次，再照第 2 小步存。

## 5. 填设置

设置都存在住户自己身上，跟网页设置页（右上角的齿轮）是同一份，用户以后在网页上能看到、能改。一次填一项：

```bash
curl -sS -X POST <住户地址>/web/config -H "x-web-key: <网页钥匙>" -H "content-type: application/json" \
  -d '{"key":"TG_ALLOWED","text":"@用户名"}' | grep -o '"error":"[^"]*"' || echo 已存
```

把 `key` 和 `text` 换掉，依次填：

| `key` | `text` |
|---|---|
| `TG_ALLOWED` | 第 0 步问到的 Telegram 用户名，比如 `@your_name`；几个人用逗号隔开。不填它谁都不回 |
| `TIME_ZONE` | 第 0 步换好的时区，比如 `Asia/Shanghai` |
| `CHECKIN_SCHEDULE` | 要主动找的话，比如 `every day at 09:00`；不要就别填 |

打印 `已存` 就是存上了；打印 `"error":…` 就照着报错改。别的设置（搜网、语音、表情包这些）先不用动，默认就能用，README「设置一览」有全部的。

## 6. 接上 Aelios（不要长期记忆就跳过）

### 在 Aelios 里给住户一个身份

住户从 Aelios 的模型接口聊天，Aelios 按身份决定用哪份记忆、记哪些模型的对话。

先拿 Aelios 现在的配置（要 Aelios 钥匙：用户愿意给你就用；不愿意就请用户打开 `<Aelios 地址>/admin` 自己在「助手」里加，加完把身份名告诉你）：

```bash
curl -s <Aelios 地址>/api/gateway/config -H "Authorization: Bearer <Aelios 钥匙>"
```

- **住户就是用户在别处聊的那个 AI**：用那个助手已有的身份，记下它的 `slug`。看它的 `models` 能不能对上住户要用的模型，对不上就把模型加进去（照下面的 PATCH，只改这一项）。
- **住户是另一个 AI**：新建一个身份。`slug` 用这个 AI 名字的小写拼音或英文。

PATCH 时 **`identities` 是整份替换的**：把拿到的配置里已有的身份原样放进列表，再加新的这个。

```bash
curl -sS -X PATCH <Aelios 地址>/api/gateway/config \
  -H "Authorization: Bearer <Aelios 钥匙>" -H "Content-Type: application/json" \
  -d '{
    "identities": [
      "...已有的身份原样放这里...",
      { "slug": "<名字>", "namespace": "default", "keys": ["CHATBOX_API_KEY"],
        "models": ["*claude*"],
        "userName": "<用户的称呼>", "assistantName": "<AI 的名字>" }
    ]
  }'
```

- **`models` 用通配符，别写死。** 用 Claude 就写 `*claude*`，用 DeepSeek 就写 `*deepseek*`。住户发给 Aelios 的 Claude 名字会把点换成横杠（`anthropic/claude-sonnet-4.6` 到 Aelios 是 `anthropic/claude-sonnet-4-6`），通配符两种都认，写死了容易对不上。别写成单独一个 `*`。
- `namespace` 跟用户别处的助手用同一个（一般是 `default`），这样两边是同一份记忆。
- 用户没给称呼，就把 `userName`、`assistantName` 整项删掉。
- 别动 `upstream` 和 `settings`，PATCH 里不写它们就不会变。

### 在住户里填上 Aelios

照第 5 步的命令，依次填：

| `key` | `text` |
|---|---|
| `AELIOS_URL` | `<Aelios 地址>`，不带末尾的斜杠 |
| `AELIOS_API_KEY` | `<Aelios 钥匙>`。用户不愿意给你的话，请用户打开网页门 → 齿轮 → 「长期记忆」自己填 |
| `AELIOS_IDENTITY` | 上面那个身份的 `slug` |

`AELIOS_NAMESPACE` 不用填，默认就是 `default`。

验一下：

```bash
curl -s <住户地址>/web/check -H "x-web-key: <网页钥匙>"
```

`"aelios":true` 就接上了。

## 7. 选模型

**用自己的 key、又没接 Aelios 的**，先让用户存 key（接了 Aelios 的，key 在 Aelios 那边已经存好了，跳过这段）：

- 厂商的 key（Anthropic、OpenAI、DeepSeek 等）：这一步用户在 Cloudflare 后台自己点，你别碰 key。把这个链接给用户：<https://dash.cloudflare.com/?to=/:account/ai/ai-gateway>，告诉用户：进 `default`（没有就先建一个叫 `default` 的）→ **Provider Keys** → **Add API Key**，选厂商、粘贴 key，别名填 `default`，保存。
- 中转站：请用户打开网页门 → 齿轮 → 「供应商」，自己填中转地址（写到 `/v1` 为止）和 key；那家说的是 Anthropic 的格式，就把格式选 `anthropic`。

然后换模型。住户会先拿这个模型试一句，调不通就不换，报错里写着为什么：

```bash
curl -sS -X POST <住户地址>/web/model -H "x-web-key: <网页钥匙>" -H "content-type: application/json" \
  -d '{"text":"anthropic/claude-sonnet-4.6"}'
```

返回里 `"model"` 是你填的名字就换好了。模型名照仓库里 `public/models.json` 的 `id` 写（Cloudflare 的写法，版本号用点）；中转的写 `custom/<那家的模型名>`。用户什么 key 都没有就不用换，留空就是免费的 `@cf/zai-org/glm-4.7-flash`。

常见报错：

- **「在 Aelios 里不是这个身份的主模型」**：第 6 步身份的 `models` 对不上这个模型，改通配符。
- **Unified billing unavailable**：Cloudflare 没找到用户存的 key。多半是存错了 Gateway（住户找的是设置里「AI Gateway 的名字」那个，留空就是 `default`；接了 Aelios 的是 Aelios 用的那个）、别名不是 `default`，或者厂商选错了。
- **Unknown gateway provider**：AI Gateway 后台建的自定义 provider（`custom-xxx/…`）住户不认，改走设置页「供应商」的中转，模型写 `custom/…`。

## 8. 人设

用户给了人设文字的话，存成一个文件（比如 `persona.txt`），这样填，不用自己转义：

```bash
node -e 'process.stdout.write(JSON.stringify({text:require("fs").readFileSync(process.argv[1],"utf8")}))' persona.txt \
  | curl -sS -X POST <住户地址>/web/persona -H "x-web-key: <网页钥匙>" -H "content-type: application/json" --data-binary @- \
  | grep -o '"error":"[^"]*"' || echo 已存
```

填完把 `persona.txt` 删掉，或者交还给用户，别提交进仓库。用户不想给你的话，告诉用户：打开网页门，点右上角的铅笔，贴上、保存。没有人设也能聊，用的是一段很短的默认人设。

## 9. 试一句，再打开 Mini App

**Telegram**：请用户在 Telegram 里给 bot 发一句话，有回复就通了。再发 `/status`，看模型和 Aelios 那两行对不对。

- **bot 不回**：多半是白名单不对。跑 `npx wrangler tail aelios-resident`，请用户再发一句，日志里出现 `dropped message from a chat not in TG_ALLOWED` 的话，后面带着这个人的 `chatId` 和 `username`：把 `@username` 或数字 `chatId` 照第 5 步填进 `TG_ALLOWED`（没有用户名的就填数字）。什么日志都没有的话，看第 4 步的返回是不是都是 `"ok":true`。
- **回了但说调不了模型**：回第 7 步。

**Mini App**：第 4 步已经把 bot 左下角的菜单按钮设成了「打开网页」，点它网页门就在 Telegram 里打开，凭 Telegram 签过名的身份进门，不用填网页钥匙。请用户：

1. 回到跟 bot 的私聊，点输入框左边的「打开网页」按钮（没看到的话，退出这个聊天再进来，或者重开一次 Telegram）。
2. 看能不能打开、能不能看到刚才在 Telegram 上说的那几句。在网页里说一句，它在网页上回。

打不开或者一片空白：

- 跑 `npx wrangler tail aelios-resident`，请用户再点一次按钮。日志里有 `web: Mini App user not in TG_ALLOWED` 的话，后面是这个人的 `id` 和 `username`，照第 5 步把它加进 `TG_ALLOWED`。
- 按钮还是旧的，或者没有按钮：再跑一次第 4 步第 4 小步那条命令，看 `setChatMenuButton` 是不是 `"ok":true`。Mini App 只认 https 的地址。
- 用户以后给住户绑了自己的域名：从新域名再跑一次第 4 步第 4 小步（把命令里的 `<住户地址>` 换成新域名），按钮就指到新域名。

## 10. 别的功能：一项一项问

能聊了以后，下面这些一项一项问用户要不要、怎么配。用户说不要的就跳过，默认值都能直接用。每项都照第 5 步的命令填，要填 key 的照下面的写法。

**要填 key 时**：

- 你手上有这把 key（比如环境变量 `TAVILY_API_KEY`），用户同意用在这里：从环境变量直接填，值不打印。先看有没有：

  ```bash
  test -n "$TAVILY_API_KEY" && echo 有 || echo 没有
  ```

  有就这样填（第一个参数是设置名，第二个是环境变量名）：

  ```bash
  node -e 'process.stdout.write(JSON.stringify({key:process.argv[1],text:process.env[process.argv[2]]??""}))' TAVILY_API_KEY TAVILY_API_KEY \
    | curl -sS -X POST <住户地址>/web/config -H "x-web-key: <网页钥匙>" -H "content-type: application/json" --data-binary @- \
    | grep -o '"error":"[^"]*"' || echo 已存
  ```

- 你手上没有：请用户打开网页门 → 齿轮，在对应那一栏自己填。别让用户把 key 发给你。

填完的 key 设置页上只显示「已填」，看不到值。

### 搜网

默认开着：一个自己的 key 都没有时，用 Cloudflare 的 Web Search，按次从 AI Gateway 的额度里扣一点（README「花钱吗」有价钱）。

- 问用户有没有 Tavily、Brave、Perplexity 的 key，有几个填几个：`TAVILY_API_KEY`、`BRAVE_API_KEY`、`PERPLEXITY_API_KEY`，按这个顺序用，一家不行换下一家。
- 不想让它搜：`WEB_SEARCH` 填 `off`。
- 接了 Aelios 的，搜到的长期知识默认会存进 Aelios（`WEB_LEARN`）；用户不想要就填 `off`。

### 读网页

默认开着，不用 key。长网页先用一个便宜的模型压短再给它看，默认是 Workers AI 的 `@cf/qwen/qwen3-30b-a3b-fp8`，免费档的每日额度里就能用。

- 一般不用改。用户想换成别的模型压（比如自己有 key 的某个便宜模型），`WEB_FETCH_MODEL` 填那个模型名，第 7 步能填的名字这里都能填；填 `off` 就不压、只截断。
- 要它读 Cloudflare Access 挡着的网站、GitHub 私库的文件：设置页「搜网和读网页」→「带钥匙的网站」，请用户自己填，README「搜网和读网页」有步骤。
- 不想让它读网页：`WEB_FETCH` 填 `off`。

### 语音条

听语音一直开着，不用配。发语音要选一家，默认不发。问用户要不要它发语音条，要的话用哪家：

| `VOICE_PROVIDER` | 还要填 |
|---|---|
| `elevenlabs` | `VOICE_ID`（声音的 id，在 ElevenLabs 的声音库里复制） |
| `cartesia` | `VOICE_ID`（在 Cartesia 的声音库里复制） |
| `openrouter` | `VOICE_MODEL`（比如 `minimax/speech-2.8-hd`），`VOICE_ID` 填声音名字，不填用模型自己的 |

- key：最省事的是请用户把那家的 key 存进住户用的 AI Gateway（设置里「AI Gateway 的名字」，留空就是 `default`）→ **Provider Keys**，别名 `default`，跟第 7 步一样，这样设置页不用填。或者 `VOICE_API_KEY` 照上面「要填 key 时」的办法填。
- 什么时候发（`VOICE_REPLY`）：`mirror` 用户发语音才回语音（默认），`always` 每条都发，`tool` 它想发才发。
- 填完请用户在 Telegram 上发一条语音试试。发不出去时 `/status` 的语音那一行写着为什么；报 401、说没收到 key 的，多半是 key 存在了别的 Gateway 里（README「遇到问题」）。

### 表情包

默认开着，但一个包都没有，它也会自己画像素小表情。问用户有没有想导入的 Telegram 贴纸包：

```bash
curl -sS -X POST <住户地址>/web/stickers/import -H "x-web-key: <网页钥匙>" -H "content-type: application/json" \
  -d '{"url":"https://t.me/addstickers/<包名>"}' | grep -o '"error":"[^"]*"' || echo 导入了
```

zip 包贴网址也行（同一个接口，`url` 填 zip 的 https 网址）；本地的 zip 请用户在设置页「表情包」里传。

Telegram 包导进来时每张只有 emoji，它不知道什么时候发。导完给常用的几张写上「什么时候用」：

1. 列出来：`curl -s <住户地址>/web/stickers -H "x-web-key: <网页钥匙>"`，每张有 `key`、`emoji`、`when`。
2. 看图：`curl -s <住户地址>/stickers/<key> -o <key>.img`，你看得了图就自己看着写；看不了就问用户。视频贴纸（`"video":true`）看不了就跳过。
3. 写上（一句话，中英文都行，最多 160 字）：

   ```bash
   curl -sS -X POST <住户地址>/web/stickers/edit -H "x-web-key: <网页钥匙>" -H "content-type: application/json" \
     -d '{"key":"<key>","when":"被夸了，有点得意"}' | grep -o '"error":"[^"]*"' || echo 已存
   ```

下载的图看完就删掉。用户不想要表情：`STICKERS` 填 `off`。

### 叫云端 Claude Code 干活

要有 Claude 的付费订阅（Pro、Max 这些），默认关着。开了以后，用户叫它改代码、做文件、查一大堆资料时，它把活交给用户 claude.ai 上的一个定时任务，开一个云端 Claude Code 会话去干，用订阅的额度。问用户要不要；要的话：

1. 你拿到要贴进定时任务的提示词，存成文件交给用户：

   ```bash
   curl -s <住户地址>/web/tasks -H "x-web-key: <网页钥匙>" \
     | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).prompt))' > routine-prompt.txt
   ```

2. 请用户打开 <https://claude.ai/code/routines> 新建一个定时任务：把 `routine-prompt.txt` 的内容贴进去，选好模型、要它改的仓库和云端环境。
3. 请用户在「触发」里加一个 API，复制网址，点「生成 token」。网址不是秘密，用户可以告诉你；**token 请用户自己填**：网页门 → 齿轮 → 「云端 Claude Code」，或者在用户自己的终端里 `npx wrangler secret put CLOUD_TASK_TOKEN`。
4. 请用户在这个定时任务用的云端环境里，把网络访问选「自定义」，把住户的域名（`<住户地址>` 去掉 `https://`）加进允许的网站，不然结果交不回来。
5. 你填上开关和网址：`CLOUD_TASKS` 填 `on`，`CLOUD_TASK_URL` 填用户给的网址（形如 `https://api.anthropic.com/v1/claude_code/routines/trig_…/fire`）。
6. 试一下：

   ```bash
   curl -sS -X POST <住户地址>/web/tasks/test -H "x-web-key: <网页钥匙>" -H "content-type: application/json" -d '{}' \
     | grep -o '"error":"[^"]*"' || echo 派出去了
   ```

   过几分钟看 `curl -s <住户地址>/web/tasks -H "x-web-key: <网页钥匙>"`，最新那单「接通测试」的 `status` 变成 `done` 就接通了。一直是 `sent` 或 `working`：请用户点那一单的 `sessionUrl`，看会话卡在哪；多半是第 4 小步的网络没放开。

`routine-prompt.txt` 交给用户以后删掉。

### 接别的 MCP

不用现在配。告诉用户：设置页「别的 MCP」填服务地址就能接；也可以在聊天里说「接上 https://…」，它自己接。带 key 的地址别在聊天里发，只在设置页接。

### 别的

- 想让它主动找你（第 0 步问过的）没填的，现在照第 5 步填 `CHECKIN_SCHEDULE`。
- 心跳默认开着：用户一阵子没说话、对话还短时，它会想想要不要找用户，一段沉默最多问 3 次。用户嫌打扰：`HEARTBEAT` 填 `0`；想多几次就填次数，最多 `10`。
- 闹钟默认关着。问用户要不要让它自己定闹钟（提醒用户的事、晚点再来找用户），告诉用户闹钟要是在一小时以上没说话之后响，比平时一条贵不少。要的话 `ALARMS` 填 `on`。
- 别的设置（交接信多久写一次、Claude 想多久、缓存多久这些）都有默认值，一般不用动，README「设置一览」有全部的。

## 11. 交给用户

最后用一小块话交给用户，照这个样子：

```text
Telegram：@<bot 的用户名>，私聊它就行
网页门：<住户地址>
网页钥匙：<网页钥匙>
```

再补几句：

- 网页门和 Telegram 是同一段对话。在 Telegram 里点 bot 左下角的「打开网页」，就是 Mini App，不用再填钥匙。
- 换模型点网页门左上角的模型名，改人设点右上角的铅笔，别的设置点齿轮。改完下一句就生效。
- 第 10 步配了什么、没配什么，一句话说清楚；没配的以后在设置页里开，README 有说明。
- 网页钥匙怀疑漏了：照第 3 步再生成一把，旧的就作废了。

## 12. 以后点一下就更新（推荐）

第 2 步是从这台机器部署的。让 Cloudflare 改从用户的 fork 构建，以后在 GitHub 上点 **Sync fork** 就自动更新。这一步只能用户在后台点：

1. **Workers & Pages** → `aelios-resident` → **Settings → Build** → **Connect**。
2. 选 GitHub 上的 fork。第一次会让装 Cloudflare 的 GitHub App，照提示装。
3. 构建命令留空，部署命令用默认的 `npx wrangler deploy`，保存。

连好以后，有 gh 的话可以替用户同步：`gh repo sync <用户的 fork>`。不连也能用，只是以后更新要 `git pull` 再 `npm run deploy`。Secret 和设置页里的设置，重新部署都不会丢。

## 附：其它

- **不想用命令行部署的用户**：照 README「上线」在 Cloudflare 后台点着装，装好再从第 3 步往下做（跳过第 2 步），第 3 步的 `wrangler secret put` 要在这个仓库的目录里跑，或者带上 `--name aelios-resident`。
- **查日志**：`npx wrangler tail aelios-resident`。
- **设置项都有哪些、默认是什么**：README「设置一览」。用接口填的跟在设置页里填的是同一份。
