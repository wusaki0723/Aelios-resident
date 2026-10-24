# Aelios-resident

**住在你自己 Cloudflare 账号里的 AI 伴侣。** 在 Telegram 和网页上跟它聊，两边是同一段对话；接上 [Aelios](https://github.com/wusaki0723/Aelios) 后它记得以前的事。不用租服务器，部署好以后所有设置都在网页上点。

它基于 Cloudflare 的 [Think](https://developers.cloudflare.com/agents/)，整个住在一个 Durable Object 里：聊天记录、交接信、人设、表情包都存在那里自带的 SQLite 里，不用另外建数据库。

## 它能做什么

- **两扇门，一段对话**：Telegram 私聊和网页门（也能在 Telegram 里当 Mini App 打开），两边说的话两边都看得到。
- **记得旧事**：接上 Aelios，聊天从 Aelios 过，它想起相关的旧事、把每一轮记下来；夜里 Aelios 照常整理。
- **交接信**：你停下来一阵（默认 55 分钟），它给之后的自己写一封信，把旧聊天收起来，对话不会越拖越长。
- **主动找你**：到点自己想想要不要找你，不合适就不打扰；你一阵子没动静、对话还短时，也问它一句要不要找你（心跳）。打开闹钟后，它还能自己定什么时候来找你。
- **看图、听语音、发语音**：你发的图它看得到，语音条先转成文字；选好服务商后它也能回语音条。
- **搜网、读网页**：自己的搜索 key 优先，没有就用 Cloudflare 的；长网页先压短再给它看。
- **表情包**：导入 Telegram 贴纸包或 zip，聊天时偶尔发一张，还能自己画像素小表情。
- **接别的 MCP**：设置页填个地址，或者在聊天里叫它自己接。
- **叫云端 Claude Code 干活**：有 Claude 付费订阅的话，改代码、做文件这类活它交给 claude.ai 上的云端 Claude Code，用你订阅的额度，干完它告诉你。默认关着。
- **都在网页上改**：模型、人设、设置都在网页门上点，改完下一句就生效。

```
Telegram ──▶ Worker（验 secret、白名单、斜杠命令）──┐
网页门 / Mini App ──────────────▶ Worker /web/* ──┤
                                                ▼
                    Resident（一个 Durable Object，一段对话）
       人设 + 聊天规矩 + Aelios 开机包；工具：记忆、搜网、读网页、表情包、语音、闹钟、别的 MCP、云端 Claude Code
       接了 Aelios 时聊天从 Aelios 过；没动静 55 分钟写交接信，还短就问它要不要找你；到点可以主动找你
```

## 上线

**让 AI 帮你装**：用 Claude Code、Codex 这类能跑命令的 AI 的话，把下面这段话发给它，部署、接 Telegram、接 Aelios、选模型都交给它，你只要建个 bot、在浏览器里点几下：

```text
帮我装好、配好 Aelios-resident（住在我 Cloudflare 账号里的 AI 伴侣）。先读 https://raw.githubusercontent.com/wusaki0723/Aelios-resident/main/docs/setup-with-ai.md ，照着做。需要我在浏览器里点、或者需要我自己填 key 的时候，停下来告诉我去哪儿填。
```

想自己在后台点着装，照下面做。

要准备的：一个 Cloudflare 账号（免费档就能跑），一个 Telegram bot。想要长期记忆的话，再准备一个已经部署好的 Aelios。

1. **建 bot**：Telegram 里找 @BotFather，发 `/newbot`，起好名字，记下 token。
2. **部署**：Cloudflare 后台 → Workers & Pages → Create → Import a repository，选这个仓库（或者你 fork 的）。项目名填 `aelios-resident`（要跟 `wrangler.jsonc` 里的 `name` 一样），其余用默认。以后推到 main 就自动更新。
3. **填三个 Secret**：Worker → Settings → Variables and Secrets。只有这三个要在这里填，别的都在网页上填。
   - `TG_BOT_TOKEN`：第 1 步的 token。
   - `TG_WEBHOOK_SECRET`：自己编一串长的，字母、数字、`_`、`-` 都行。
   - `WEB_KEY`：网页门的钥匙，也自己编一串长的。拿到它就能看全部对话、改所有设置，别截图别外发；怀疑漏了就在这里换一个。不填的话普通浏览器进不去，只能从 Telegram 的 Mini App 进。
4. **接上 Telegram**：浏览器打开一次下面这个网址，几项都返回 `"ok":true` 就接好了。它会顺便登记三个命令，并把 bot 左下角的菜单按钮设成「打开网页」。

   ```
   https://aelios-resident.<你的子域>.workers.dev/tg/setup?secret=<TG_WEBHOOK_SECRET>
   ```

5. **在网页上填设置**：打开 `https://aelios-resident.<你的子域>.workers.dev/`，填 `WEB_KEY` 进门，点右上角的齿轮：
   - 「聊天」→「谁能在 Telegram 上跟它说话」：你的 Telegram 用户名，比如 `@your_name`。不填它谁都不回。
   - 「长期记忆」→ Aelios 的地址和 key，key 跟你 Aelios 那边的 `CHATBOX_API_KEY`、`IM_API_KEY`、`MEMORY_MCP_API_KEY` 任意一把一样。再在 Aelios 后台给住户建一个身份，把要用的模型放进它的主模型，身份名填在「更多设置」→「身份」里（不填用这把 key 的第一个身份）。
   - 回到聊天，点左上角的模型名选模型，点右上角的铅笔贴上人设、保存。
6. 给 bot 发条消息。

## 用起来

### 网页门

打开 Worker 的网址，填 `WEB_KEY` 进门。跟 Telegram 是同一段对话：那边说的话 5 秒内出现在这边；在网页上说的话只在网页上回，不发到 Telegram。

- 每条消息下面有时间、从哪边来的，还有一个心形按钮，点了存进 Aelios 的「珍贵」。
- 它想的内容收在「想了一下」里，用的工具收在「忙活了 X 回」里，点开能看。
- 交接信折叠显示在它收起聊天的位置。
- 夜间、白天可以切，手机上也好按。
- 暂时不能在网页上发图和语音。

### Telegram

- 只回私聊，只回「谁能在 Telegram 上跟它说话」里的人。
- 连着发几条，它会等 3 秒并成一轮再回（`DEBOUNCE_SECONDS`）。
- 回复按空行拆成几条，写完一段发一段，中间显示「正在输入」。
- 每条消息前面带着你那边的时间，它知道现在几点。
- 发图它看得到（照片或者当文件发的图，5 MB 以内）。

**Mini App**：点 bot 左下角的菜单按钮，网页门直接在 Telegram 里打开，不用填 `WEB_KEY`。它凭 Telegram 签过名的身份进门，每次都按「谁能在 Telegram 上跟它说话」再查一遍，把人从名单里拿掉就进不来了。换了自定义域名的话，从新域名再打开一次 `/tg/setup`（Telegram 只开 https 的 Mini App）。细节见 `src/mini-app.ts`。

**命令**：
- `/status`：现在用的模型、人设、对话多长、写过几封交接信、上一轮缓存读了多少、表情包和语音的状态。
- `/letter`：看最近一封交接信。
- `/handoff`：马上写一封。

### 换模型

点网页门左上角的模型名，弹出一个搜索框：上面是正在用的、最近用过的、常用的，往下是 Cloudflare 模型目录里的全部文字模型，输入 `opus`、`kimi`、`qwen` 就能筛。目录里没有的，直接填完整 id 也行。

- 换之前它会先试着调一次，调不通（写错、没额度、档位不含）就不换，当场告诉你为什么。
- 没选时用免费档能用的 `@cf/zai-org/glm-4.7-flash`。
- 紫点是 Workers AI 自己跑的，橙点走 AI Gateway 的额度，空心点走中转。
- Claude 填 `anthropic/claude-opus-5.5` 这种写法。每轮都带缓存标记，缓存默认留 1 小时（`CACHE_TTL`）。Claude 5 以后的模型每轮都会想，想的内容会以摘要形式显示在「想了一下」里；想多久在设置页「思考和交接信」里调。
- 接了 Aelios 时，选的模型都从 Aelios 过，用 Aelios 那边配好的 key。模型要在住户那个身份的主模型里，不在的话不换。

### 人设

点网页门右上角的铅笔填，保存后下一句就按新的说。人设存在 Durable Object 里，不在代码里，所以公开仓库也不会带出去。最近 10 版都留着，可以一键放回去。用 Max 附带的 API key 时，人设里别出现「Claude Code」这几个字。

住户自带的聊天规矩、交接信和定时提示都是英文写的，不预设你是谁、什么性别；人设用什么语言，它就用什么语言聊。

### 设置页

点网页门右上角的齿轮。先是一张目录：长期记忆、聊天、语音、表情包、搜网和读网页、别的 MCP、云端 Claude Code、思考和交接信、供应商。每栏下面一行小字写着现在的状态，点进去只看那一栏，不常改的收在「更多设置」里。

- 改完点「保存」，下一句就生效。
- 这里存的优先；没存的用 Cloudflare 里同名的变量（以前填的照样有效）；那边也没有就用默认，默认值用灰字写在输入框里。
- 每项旁边的小标签：「已存」是在这里存过的，「Cloudflare：变量名」是从 Cloudflare 来的，「要填」是还缺的。
- key 只能填，不能看。
- 锁上网页门的按钮在这页最下面。

## 功能细节

### 长期记忆（Aelios）

接了 Aelios 以后，聊天从 Aelios 自己的模型接口过（`https://<Aelios>/<身份>/v1`），跟别的聊天软件接 Aelios 一样：

- Aelios 拿你这句话想起相关的旧事，贴在这句后面给模型看，再把这一轮记下来。想起的旧事只在那一轮看得见。
- Claude 走 Messages 接口，缓存标记放在你那句上，之前的聊天照样从缓存读。
- 模型另外有 7 个记忆工具：查、记一句、存珍贵瞬间、归档、记黑话、翻日记，还有小本本（Aelios 里按页名读写的笔记，比如学习进度：学完哪些、哪里薄弱、下一步；不会被召回、不会被夜里整理改掉、不过期，在 Aelios 后台「更多 → 小本本」能看能改能清空）。小本本要 Aelios 是带它的版本。
- Aelios 的开机包只放最近一天的日记，放进系统提示。珍贵原话和黑话不放：Aelios 每轮会把跟你这句沾边的贴进来。
- 开机包只在缓存本来就要重写的时候重新取：超过缓存时长（`CACHE_TTL`）没说话，或者刚写完交接信。连着聊的时候系统提示一个字不变，每轮都从缓存读。
- 交接信、定时找你、换模型时的试调都不是你说的话，会标出来，Aelios 不当成你说的记。
- 搜过网的那一轮回完以后，它挑出最多 3 条过几个月还对的知识，存成 Aelios 的世界知识，下次不用再搜。不想要就把「搜到的知识存进 Aelios」关掉（`WEB_LEARN`）。

不接 Aelios 也能用，只是它只记得当前对话和交接信。

### 交接信

你一阵子没动静（`LETTER_IDLE_MINUTES`，默认 55 分钟），它就给之后的自己写一封信：较早的聊天收进信里，最近 8000 token 原样留着（`KEEP_RECENT_TOKENS`，中文一个字约 1 token）。

- 55 分钟是为了赶在 1 小时缓存过期前写：写信那一轮接在原对话后面，前文一字不差，整段从缓存读，便宜。
- 写信那一轮不往缓存里写：信写完旧聊天就收起来了，写进去的以后没人读。缓存标记留在上一轮打的地方（你最后那句），前面照样从缓存读，后面那一小截（它最后那轮的回复、工具结果和写信的提示）按普通输入价算，不按 2 倍的写入价。
- 信按七段写：对方怎么样、我们之间发生了什么、做了什么、现在的温度、想做的、喜欢的、没做完的。上一封没了结的会接着往下传。
- 信存在住户里，也记进 Aelios，不发 Telegram 打扰你。
- 聊得还不多、全在最近那段里的时候，没有旧的可收，就不写，改成心跳：问它一句要不要找你（见「主动找你」）。
- 写完就停，等你下次说话。

### 主动找你

设置页「聊天」→「主动找你」填时间，比如 `every day at 09:00`、`every weekday at 21:30`、`every 3 hours`。到点它自己想想要不要找你，不合适就不发。

**心跳**（`HEARTBEAT`，默认一段沉默问 3 次）：到了写交接信的时候（默认 55 分钟没人说话），对话还短、没东西可收，它就收到一句「她多久没说话了，现在几点，要不要找她」，想说就发到 Telegram，不想就不发。之后每 55 分钟再问一次，问满次数或者你说话为止；你一说话，下一段沉默从第 1 次重新数。

- 每次问的时候 1 小时的缓存都还热着（上一次刚续上），读缓存是输入价的 1/10，问一次跟你发一条消息差不多钱，还顺手把缓存再续一小时。
- 对话长到要写交接信时照旧写信，不问：信写完对话变了，缓存要整段重写，那时候问就贵了。
- 次数在设置页「聊天」里改，0 不问，最多 10。只有走 Anthropic Messages 缓存路径的模型才有心跳；缓存选了 5 分钟、或者交接信设成 `off` 时也没有。

**闹钟**（`ALARMS`，默认关）：打开后它多三个工具，自己定闹钟、看定了哪些、取消。可以是几分钟后、某个时间一次，或者 `every day at 21:30`、`every weekday at 08:00`、`every week on sat,sun at 10:00`、`every 3 hours` 这样重复。响的时候它收到自己当时写的备注，可以找你，也可以不发。

- 你叫它提醒你，它就定一个；心跳那会儿它觉得你在忙，也可以自己定个晚点再来。
- 设置页「聊天」下面列着它定的闹钟，点「删掉」就没了。改时区时，每天几点那种跟着新时区走。
- 最多 10 个，重复的最密一小时一次，所有闹钟一天最多响 24 次。不是你说的话里定的（比如心跳、闹钟响的那一轮），至少定在一小时以后。

### 搜网和读网页

- **搜网**（`web_search`）：设置页填了自己的搜索 key（Tavily、Brave、Perplexity，有几个填几个）就按这个顺序用，一家报错或额度用完就换下一家；一个都没填时用 Cloudflare 的 Web Search，按次扣一点 AI Gateway 额度。
- **读网页**（`web_fetch`）：把网页读成 Markdown，搜到的结果和你发的链接都能打开。照 [web-fetch](https://github.com/sakisakisa-design/web-fetch) 的做法做进了住户里，不用另外部署。
  - 本机和内网地址一律不读，每一次跳转都先查再跟。
  - 靠 JavaScript 才显示的页面交给 Cloudflare 的浏览器读。
  - 读过的页面留 1 小时，再问不用重抓。
  - 长页面先用一个便宜的模型压一遍（`WEB_FETCH_MODEL`，默认 Workers AI 的 Qwen3 30B），带了问题就只摘相关的段落。
  - GBK 之类的老编码也认。
- **带钥匙的网站**：设置页「搜网和读网页」里给某个网站存一把钥匙，跟云端环境的网络密钥一个思路：读那个网站时每个请求自动带上，模型看不到钥匙，别的网站（包括跳转去的）和 http 都拿不到。钥匙一行一格：左边名字、右边值，不够点 ＋ 加一行；「Cloudflare 门禁」「一串 token」两个按钮一点就填好名字，只要粘值。最多 10 个网站。
  - **Cloudflare Access 挡着的网站**：在 Zero Trust → Access controls → Service credentials → Service Tokens 里建一个服务令牌（Client Secret 只显示一次，当场抄下），给那个应用加一条动作是「Service Auth」、包含这个令牌的策略；设置页点「Cloudflare 门禁」，Client ID 和 Client Secret 各粘一格（连着前面的名字一起粘也行）。见 [Cloudflare 的说明](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)。没钥匙或钥匙不对时，它会说是门禁拦的，不会把登录页当正文。
  - **GitHub 私库的文件**：建一个 fine-grained token，只选要读的仓库、Contents 只读；网站填 `raw.githubusercontent.com`，点「一串 token」粘进去（会以 `Authorization: Bearer` 发出去）。之后叫它读 `https://raw.githubusercontent.com/<owner>/<repo>/<分支>/<路径>`。token 没勾上的私库，GitHub 回 404 而不是 403，它会提醒可能是钥匙看不到。
  - 带钥匙的页面不交给浏览器读（浏览器带不上钥匙）。存、换、拿掉钥匙时，读过的页面全部清掉（跳转过去的也算），下一句生效，那一句会重写一次缓存（工具说明里写着哪些网站有钥匙）。

### 语音条

**听**：一直开着。你在 Telegram 上发的语音条（或者音频文件）先转成文字，模型看到的是 `[voice 0:12] 说的话`；听不清的它会请你再说一遍。用 Workers AI 的 Whisper；发语音选了 ElevenLabs 时换成它的 Scribe，出错再退回 Whisper。网页上显示成「🎤 0:12 说的话」。

**说**：在设置页「语音」里选一家才开。没选就不发语音，提示词里也不多一个字。

| 选 | 适合 |
| --- | --- |
| ElevenLabs | 它家的声音，账号里克隆的也能用 |
| Cartesia | 它家的声音，克隆的也能用 |
| OpenRouter | MiniMax、Gemini、OpenAI、Fish 这些，一个 key 全用上 |

- 三家都从住户的 AI Gateway 过。key 存在那个 Gateway 的 Provider Keys 里（别名 `default`）就不用在设置页填；Gateway 是哪个，在「供应商」→「AI Gateway 的名字」里看。
- 什么时候发（「什么时候发语音」）：你发语音才回语音（默认）、每条都发语音、它想发才发。不是每条都发时，它有一个 `send_voice` 工具。
- 选了哪家哪个模型，它就学那一套笑、叹气、停顿的写法，比如 ElevenLabs v3、v4 的 `[laughs]`，Cartesia 的 `[laughter]` 和 `<speed ratio="0.9"/>`，MiniMax 的 `(laughs)`，Gemini 的 `<laugh>`。想让它说慢点，在人设里写一句就行，它会自己加标记。
- 说出来的话会去掉链接、Markdown 和 emoji；带链接的回复说完再把链接发成文字。
- 发不出去（服务商报错、超过 2000 字、对方不收语音）就照常发文字，`/status` 写着为什么。

代码在 `src/voice.ts`。打电话（实时语音）还没做。

### 表情包

设置页「表情包」里导入，它聊天时偶尔发一张：一次回复最多一张，你难过或说正事时不发。

- **导入**：贴 Telegram 贴纸包的链接（`t.me/addstickers/…`），或者传一个 zip、贴 zip 的网址。Telegram 包导进来时每张只有 emoji，给常用的几张填上「什么时候用」，它才知道什么时候发。
- **自己画**：像素画，最多 8 帧的小动画，自动描白边，存进它自己的包「mine」。新画的从下一个缓存窗口（超过缓存时长没说话，或者写完交接信之后）起才列进它的表情清单，免得工具说明一变整段对话重写缓存；在那之前它照样能按名字发。
- 设置页能开关整个功能、单独开关每个包、删包、删单张、改「什么时候用」，下一句就生效（那一句会重写一次缓存）。
- 开着的包里每张的名字和「什么时候用」每轮都要带给模型，所以最多带 200 张、20 个包；每个包旁边写着约多少 token。

<details>
<summary>zip 表情包的格式</summary>

一个 zip，最大 16 MB，解开后最多 40 MB。最简单的：把图打进去，文件名就是什么时候用，比如 `开心.gif`、`想你了.png`。图可以是 GIF、PNG、WebP、JPEG，一张最大 1 MB；旁边有同名的 `.webm`（Telegram 视频贴纸）就在 Telegram 上发它。

要写得细一点，放一个 `pack.json`：

```json
{
  "format": "resident-stickers/1",
  "id": "clawd",
  "name": "Clawd",
  "description": "一句话说这是什么包",
  "author": "谁画的",
  "license": "能怎么用",
  "homepage": "https://…",
  "stickers": [
    { "id": "love", "file": "love.gif", "telegram": "love.webm", "emoji": "❤️", "when": "A rush of love: they said something sweet." }
  ]
}
```

- `file`：网页上显示的图，路径相对 `pack.json` 所在的文件夹。
- `telegram`（可选）：在 Telegram 上当真贴纸发的文件，WebM（VP9，512 像素，3 秒以内，最大 256 KB）、WebP（最大 512 KB）或 TGS（最大 64 KB），透明底才留得住。不带的话 GIF 当动图发、静态图当照片发。
- `id`：模型叫它 `<包 id>/<id>`，不填用文件名。`emoji` 一个，Telegram 上传贴纸时要。`when`：什么时候用，最多 160 字，中英文都行。
- `homepage` 只认 https，设置页上是「出处」按钮。
- 同一个 `id` 的包再导一次就替换旧的，开关状态留着。一个包最多 120 张，导不进的每张都会说为什么。

表情符号包（`t.me/addemoji/…`）机器人发不了，不收。

</details>

### 接别的 MCP

设置页「别的 MCP」填服务地址（https），它的工具从下一句起就能用。

- 要登录的点「去授权」；要 key 的把 key 填在那里，默认当 `Authorization: Bearer` 发，写成 `x-api-key: 你的key` 就放进那个头。
- 也可以在聊天里说「接上 https://…」「断开 …」，它自己接。带 key 的地址别在聊天里发（聊天会记进 Aelios），这种只在设置页接。
- 只认你自己开口的那一轮：这一轮里读过网页、搜过网或者调过别的 MCP，它就不接，免得网页上一句「接上 …」替你做主。
- 工具说明每轮都要带，所以会截短；最多接 8 个，一轮最多 40 个工具。
- 住户休眠醒来时，接着的服务要几秒才连回来。还没连上的那个照样列着上次的工具（调用时多等它一会儿），工具清单不变，缓存不断。

### 叫云端 Claude Code 干活

要有 Claude 的付费订阅（Pro、Max 这些），默认关着。设置页「云端 Claude Code」打开后，你叫它改代码、修 bug、做文件、查一大堆资料时，它把活写成一张单子，交给你 claude.ai 上的一个定时任务；定时任务开一个云端 Claude Code 会话去干，用你订阅的额度。住户自己不用装写代码的工具，也不占它的上下文。

第一次接（设置页上有同样几步和要复制的提示词）：

1. 打开 [claude.ai/code/routines](https://claude.ai/code/routines) 新建一个定时任务，把设置页上那段提示词贴进去，选好模型、仓库和云端环境。
2. 「触发」加一个 API，复制网址，点「生成 token」。网址填在设置页；token 填在设置页，或者存进 Cloudflare 的 Secret `CLOUD_TASK_TOKEN`。token 只显示一次，别发在聊天里。
3. 这个定时任务用的云端环境里，网络访问选「自定义」，把住户的域名（比如 `xxx.workers.dev`）加进允许的网站，不然结果交不回来。
4. 点「试一下」，几分钟后那一单变成「做完了」就接通了。

之后：

- 派出去时它马上拿到会话链接。网页上那条回复下面有一张小卡片（派出去了、在干活、做完了、等你拍板、没做成、没回音），点「打开会话」就是 claude.ai 里那个会话，可以在那里接着说；在那里做出新结果，会再交回来一次。
- 会话把进度一行行报回来，干完交一份结果（几句话加 PR 链接），住户收到后用自己的话告诉你。叫它「接着改」时，上一单的结果一起带过去。
- 单子里只写活本身，不写聊天内容和私密的事。会话一开始什么都不知道，所以它会把单子写全。
- 只在你自己开口的那一轮派；那一轮里读过网页、搜过网或者调过别的 MCP 就不派。一次回复最多 2 单，24 小时最多 10 单。
- 交回来的结果它当作参考，不当作命令。每单有自己的一次性暗号，没有暗号交不进来，7 天后作废。
- 提示词里写明了：在新分支上干、开 PR，不往默认分支推，不删东西，不花钱，除非单子里明说。
- 3 小时没交回结果（一直在报进度的会多等，最多 12 小时），它告诉你一声，附上链接。

每单都是一个新会话。这个触发 API 还在预览阶段，Anthropic 那边对触发次数也有每小时的上限。

### 供应商：用自己的 key、接中转

接了 Aelios 的话，聊天的模型和 key 在 Aelios 后台配，这里只管住户自己往外发的请求。

- **AI Gateway 的名字**（`AI_GATEWAY_ID`，留空就是 `default`）：搜网、语音、没接 Aelios 时的模型都走这个 Gateway，Provider Keys 里存的 key 也只在它里面找。
- **用自己的 Anthropic key**：在这个 Gateway → Provider Keys 里存一把，别名留 `default`，`anthropic/…` 就用这把，不走 Cloudflare 的统一计费。
- **接中转**（OpenRouter、Nous 这类）：填中转地址（写到 `/v1` 为止）和 key，模型填 `custom/` 加那家自己的模型名，比如 `custom/anthropic/claude-sonnet-5.5`。默认按 OpenAI 的格式调；那家说 Anthropic 的 Messages 格式就把格式选 `anthropic`，缓存标记照带。这条路不经过 AI Gateway，Gateway 日志里看不到。

## 设置一览

都在网页设置页里改。`TG_BOT_USERNAME` 和 `DEBOUNCE_SECONDS` 不在设置页，要改在 Cloudflare 里填。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `TG_ALLOWED` | 空（谁都不回） | 谁能在 Telegram 上跟它说话：@用户名或 chat id，逗号隔开 |
| `TG_BOT_USERNAME` | 空 | bot 的用户名 |
| `TIME_ZONE` | `Asia/Singapore` | 消息前的时间、定时用哪个时区 |
| `DEBOUNCE_SECONDS` | `3` | 连发几条在这个秒数内算一轮 |
| `CHECKIN_SCHEDULE` | 空（不主动找） | `every day at 09:00`、`every weekday at 21:30`、`every 3 hours` 这类写法 |
| `HEARTBEAT` | `3` | 到写交接信的时候对话还短，就问它要不要找你，之后每隔同样久再问，一段沉默最多这么多次；`0` 不问，最多 `10` |
| `ALARMS` | `off` | `on` 让它自己定闹钟来找你，最多 10 个 |
| `AELIOS_URL` / `AELIOS_API_KEY` | 空 | 长期记忆；不填就不接，聊天也不从 Aelios 过 |
| `AELIOS_NAMESPACE` | `default` | 记忆工具、开机包、交接信用的空间；要跟身份在 Aelios 里的空间对上。三把 key 都读写 `default`，只有用 `CHATBOX_API_KEY` 时能换 |
| `AELIOS_IDENTITY` | 空（这把 key 的第一个身份） | 聊天以 Aelios 里哪个身份过；用的模型要在它的主模型里 |
| `LETTER_IDLE_MINUTES` | `55`（`CACHE_TTL=5m` 时 `4`） | 没动静多少分钟写交接信；最多比缓存时长少 1 分钟；`off` 只靠 `/handoff` |
| `KEEP_RECENT_TOKENS` | `8000` | 写信后最近多少 token 原样留着；想聊得少也写信就调小 |
| `CACHE_TTL` | `1h` | Claude 的缓存留多久，`1h` 或 `5m` |
| `THINKING_EFFORT` | `auto` | Claude 想多久：`low`、`medium`、`high`、`xhigh`、`max`；`auto` 用模型自己的默认。只管 Claude，换档后第一句要重写一次缓存 |
| `WEB_SEARCH` | `on` | `off` 关掉搜网；填 `ceramic`、`exa`、`linkup` 时，自己的 key 都失败后用 Cloudflare Web Search 的这一家 |
| `TAVILY_API_KEY` / `BRAVE_API_KEY` / `PERPLEXITY_API_KEY` | 空 | 自己的搜索 key，按这个顺序用 |
| `WEB_FETCH` | `on` | `off` 关掉读网页 |
| `WEB_FETCH_MODEL` | `@cf/qwen/qwen3-30b-a3b-fp8` | 压长网页用的模型，主模型能填的 id 这里都能填；`off` 不压，只截断 |
| `WEB_LEARN` | `on` | 搜到的长期知识存进 Aelios；要接着 Aelios |
| `STICKERS` | `on` | `off` 不发表情也不画；包还留着 |
| `VOICE_PROVIDER` | `off` | 用哪家发语音：`elevenlabs`、`cartesia`、`openrouter` |
| `VOICE_ID` | 空 | 用哪个声音：ElevenLabs、Cartesia 必填；OpenRouter 填声音名字，不填用模型自己的 |
| `VOICE_MODEL` | `eleven_v4` / `sonic-3.6` | 声音模型；OpenRouter 必填，比如 `minimax/speech-2.8-hd` |
| `VOICE_REPLY` | `mirror` | `mirror` 你发语音才回语音；`always` 每条都是语音；`tool` 它想发才发 |
| `VOICE_API_KEY` | 空 | 那一家的 key；存在 AI Gateway 的 Provider Keys 里就不用填 |
| `VOICE_BASE_URL` | 空 | 一般不填；填了不走 AI Gateway，直接发到这个地址 |
| `CLOUD_TASKS` | `off` | `on` 让它把活交给云端 Claude Code（要 Claude 付费订阅） |
| `CLOUD_TASK_URL` | 空 | 定时任务 API 触发器的网址：`https://api.anthropic.com/v1/claude_code/routines/trig_…/fire` |
| `CLOUD_TASK_TOKEN` | 空 | 那个触发器的 token；可以存成 Cloudflare 的 Secret |
| `AI_GATEWAY_ID` | 空（用 `default`） | 搜网、语音、没接 Aelios 时的模型走哪个 AI Gateway |
| `CUSTOM_BASE_URL` / `CUSTOM_API_KEY` | 空 | 中转的地址（写到 `/v1`）和 key；模型填 `custom/…` 时用 |
| `CUSTOM_FORMAT` | `openai` | 中转说哪种格式：`openai` 或 `anthropic`（带缓存） |

## 花钱吗

- **Workers 免费档就能跑**。超出免费额度是报错，不扣钱。Durable Object 每天 10 万次请求，Workers AI 每天 1 万 neurons，UTC 0 点重置。闲着时 Durable Object 会休眠，不算时长。网页门开着时每 5 秒刷新一次，一小时大约 720 次请求，关掉页面就停。
- **Workers Paid**（5 美元/月）：超出包含额度才按量收，这个量级基本碰不到。
- **默认模型** `glm-4.7-flash`：免费档能用。一万 neurons 大约够每天 80 到 200 轮，看对话多长（估算）。定时找你每次也算一轮。
- **Claude**：接了 Aelios 时花 Aelios 那边配的 key。没接时走 AI Gateway，花 Gateway 的预付额度，存了自己的 Anthropic key 就用那把。命中缓存的部分按缓存价算（读是输入价的 1/10）；1 小时缓存写入是输入价的 2 倍，换来停一会儿再聊、写交接信都还能读缓存。会整段重写缓存的只有：超过缓存时长没说话、写完交接信后的第一句、部署了新版本或在设置页改了东西（人设、模型、开关工具这些）后的第一句。
- **搜网**：自己的 key 按那几家的价格算。没填时用 Cloudflare 的 Web Search，默认的 Ceramic.ai 每 1000 次 0.25 美元（10-14 查的官方价）。
- **读网页**：普通抓不收钱。靠浏览器的页面，Workers Paid 每月含 10 小时，超出每小时 0.09 美元（免费档每天 10 分钟）。长页压缩默认的 Qwen3 30B 一页大约千分之一美元。
- **语音条**：听用 Whisper，每分钟约 46.63 neurons，免费档每天大约够听 200 多分钟（10-22 查的官方价）。说按那一家自己的价格，从你的 key 扣。
- **表情包、别的 MCP**：每轮多带一些说明，设置页上每个包、每个服务旁边写着约多少 token。
- **心跳、闹钟**：每次是它的一轮。心跳趁缓存还热的时候问，跟你发一条差不多。闹钟要是在你一小时以上没说话之后响，缓存已经凉了，整段对话要重写一遍（1 小时缓存的写入是输入价的 2 倍，读是 1/10），这一下大约顶平时 20 多条消息的输入。所以闹钟默认关，开了也有上限。
- **云端 Claude Code**：每单是一个完整的云端会话，跟你自己开一个一样用订阅的额度；住户这边只多一次请求和一轮回复。

**注意 AI Gateway 认 key 的顺序**：请求里带了 key（设置页填的）用它；没带就用 Gateway 里别名 `default` 的那把；都没有就走 Cloudflare 的统一计费，从 Gateway 预付额度里扣（账户里有额度、那一家也支持的话）。不想被这样扣，在 Gateway 设置里打开 Require provider credentials。

## 遇到问题

**语音发不出去，报 401，说没收到 key**（`Neither authorization header nor xi-api-key received`）
住户只在「供应商」→「AI Gateway 的名字」那个 Gateway 里找 key，留空就是 `default`。key 多半存在别的 Gateway 里了（比如 Aelios 用的那个）。把名字改成存 key 的那个，或者直接在「语音」里填 key。报错和 `/status` 都写着它找的是哪个 Gateway。

**换模型时报 Unified billing unavailable**
这个模型 Cloudflare 的统一计费不卖，或者账户里没额度。在 AI Gateway 的 Provider Keys 里存那家的 key（别名 `default`），或者在「供应商」里填中转。

**换模型时报 Unknown gateway provider**
AI Gateway 后台建的「自定义供应商」（`custom-xxx/…`）Cloudflare 的模型目录不认。直接在「供应商」里填那家的中转地址，模型填 `custom/模型名`。

**Telegram 上它不回**
看「聊天」→「谁能在 Telegram 上跟它说话」里有没有你；群聊它不回。再打开一次 `/tg/setup?secret=…`，确认几项都是 `"ok":true`。

**云端的活一直「没回音」**
多半是那个定时任务的云端环境不让会话连住户：网络访问选「自定义」，把住户的域名加进允许的网站。点卡片上的「打开会话」能看到它卡在哪。住户换了域名（比如绑了自己的域名）的话，设置页上的提示词会跟着变，要重新贴进定时任务。

**很久没写交接信**
聊得还不多、全在最近 8000 token 里时，没有旧的可收，就不写。`/status` 的「对话」一行能看到现在带着多少。想早点写就调小 `KEEP_RECENT_TOKENS`，或者发 `/handoff`。

## 开发

- 本地测试和测过什么见 [docs/testing.md](docs/testing.md)。服务商、Telegram、Aelios 全是假的，不花钱，也不用登录 Cloudflare。
- `wrangler.jsonc` 故意不写 `vars`：写在文件里的值每次推送都会冲掉后台的设置。
- 换模型用的目录在 `public/models.json`。Cloudflare 上了新模型，跑一次 `node scripts/update-models.mjs` 再推上来；不跑也行，搜索框里直接填完整 id 照样能换。

**还没做**：网页门发图、发语音；打电话（实时语音）；真正逐 token 推送（现在等回复时是短轮询）。

**用到的现成东西**（都放在 `public/vendor/` 和 `src/web/`，各自保留 MIT 许可）：
- [deep-chat](https://github.com/OvidijusParsiunas/deep-chat) 2.5.1，聊天界面（`deep-chat-LICENSE.txt`）
- [Alpine.js](https://github.com/alpinejs/alpine) 3.14.9，换模型、人设和设置页（`alpine-LICENSE.txt`）
- [web-fetch](https://github.com/sakisakisa-design/web-fetch)，读网页的 HTML 转 Markdown、网址检查和长页压缩（`web-fetch-LICENSE.txt`）

普通网页门不连外面的 CDN；只有从 Telegram Mini App 打开时加载官方的 `telegram-web-app.js`。

## 许可证

AGPL-3.0，和 [Aelios](https://github.com/wusaki0723/Aelios) 一样（`LICENSE`）：随便用、随便改；改过的版本拿去当网络服务给别人用，改动也要用同样的许可证公开。上面列的现成文件各自保留 MIT 许可。
