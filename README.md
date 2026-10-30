# Aelios-resident

**English** | [简体中文](README.zh-CN.md)

<p align="center">
  <img src="docs/images/hero.webp" width="880" alt="Three moments on the web door: late at night it remembers you are preparing for an interview and sets an alarm; in the morning it reaches out first, in its own voice; at noon it hands the research to a background thread and comes back to tell you what it found">
</p>

<h3 align="center">One home for every AI you love.</h3>

<p align="center">
  Claude stays Claude, GPT stays GPT, each with its own name, temper and memories.<br>
  No row of apps to install, and no moving house every time a company launches something new.
</p>

<p align="center"><sub>The screens are the real interface; the conversation is an example.</sub></p>

There are more AIs all the time: one app here, another there, and the same company moves you somewhere new every few months. Each time, you move house.

Aelios-resident is a home, and every AI you love is a resident in it. The home is in **your own Cloudflare account**, around the clock. Each resident runs on its own model, with its own name, face, temper and memories; none stands in for another. On the web, on Telegram or in WeChat, it is one conversation wherever you find it. It remembers what you told it last month; when you have been quiet for a while, it checks in; and when you hand it something to do, it passes the work to a background thread and comes back to tell you once it is done.

No server to rent and no code to write: send one message to an AI that can run commands, and in ten minutes or so you are talking to it. Cloudflare's free plan is enough for it to live on. **[Move it in now →](#getting-started)**

> **The interface is in Chinese.** The web page, the settings and the bot's command replies are in Chinese. This README gives each label's Chinese text in 「」 so you can find it on screen. The resident itself chats in whatever language its persona is written in.

## A day with it

> **23:38**　You mention the interview is tomorrow and you can't sleep. It remembers that your practice run last week went well, and that you talk too fast when you are nervous. It tells you to pause for a second before you begin, and sets an alarm.
>
> **08:00**　The alarm rings. It reaches out first, in its own voice: "Morning. Eat something before you go."
>
> **11:42**　You tell it on WeChat: you passed! It answers with a little pixel heart it drew itself.
>
> **12:10**　You ask it to gather the company's recent news and the questions second rounds usually bring. It hands the legwork to a background thread and keeps talking with you; half an hour later it comes back with the report.
>
> **Late at night**　After a long day of talking, you are asleep. It writes a letter to its later self: where we left off, how you have been, what is still unfinished. It does not wake you at night.

## What it is like

### It remembers you

- Connect [Aelios](https://github.com/wusaki0723/Aelios), a memory service you deploy yourself, and everything you say brings up what is related from before, and every turn is kept. The name of the cat you mentioned months ago, what you are working toward, what you can't stand eating: it knows.
- After a long talk it writes a handoff letter to its later self and puts the older chat away, keeping only the most recent part word for word. Tomorrow picks up where today left off.
- Each resident's memories are its own: with Aelios connected, every resident has its own identity and remembers for itself.

### It comes to you

- At times you choose, it considers whether to say something; when you have been quiet for a while, it asks itself whether to reach out. Not at night, unless you want it to.
- It can set its own alarms and come back when they ring.
- Put the web door on your phone's home screen and it sends you notifications: when it reaches out, a thread finishes or an alarm rings.

### It has a voice, and a face

- It sees the pictures you send and hears your voice messages. It can answer out loud too: with ElevenLabs, Cartesia, or MiniMax, Gemini and more through OpenRouter, a voice you cloned included.
- It sends stickers: import a Telegram sticker pack, and it also draws little pixel ones of its own.
- You write its persona: its name, how it talks, who it is.

### It gets things done

- It searches the web and reads pages; store a key for a private site and it can read those pages too.
- Bigger jobs, such as digging through material, writing a report, making a page or changing code, go to a background thread while it keeps talking with you. When the work is done it tells you in its own words, and the files it made can be viewed and downloaded on the web page. It can also hand work to GitHub Actions or cloud Claude Code.
- You never keep track of threads. Say "carry on with last week's page" or "what did that research find?" and it looks up the thread, its files or what was said, by itself.
- Errands run on a cheaper model: background threads use a free model by default, and you can pick another, such as DeepSeek, so the one who keeps you company does not spend its budget on legwork.
- Connect other MCP servers and it learns more.

### It is yours alone

- It lives in your own Cloudflare account: the conversation, the persona, the stickers and the files its threads make are stored there, not with the author or any platform.
- It runs on Cloudflare's free plan, and so does its default model. For Claude and other paid models, you pay for the model calls you make, and **Usage** (「用量」) shows what each one cost.
- Open source, AGPL-3.0.

## Wherever you are

| Door | What it is |
| --- | --- |
| **The web door** | Always there. On a phone it installs like an app and sends notifications |
| **Telegram** | Optional. A private chat; the web door also opens inside Telegram as a Mini App |
| **WeCom / WeChat** | Optional. With WeCom's WeChat plugin, you can talk to it in ordinary WeChat too |

Whichever door you use, it is one conversation, and all of it shows on the web page.

## Getting started

### Let an AI set it up (recommended)

If you use an AI that can run commands, such as Claude Code or Codex, send it the message below. It deploys the resident, connects Aelios (and Telegram, if you want it) and picks a model; you only click a few things in the browser, and create a bot if you want Telegram. The guide it reads is in Chinese, which these assistants follow fine.

```text
Set up and configure Aelios-resident for me (an AI companion that lives in my Cloudflare account). First read https://raw.githubusercontent.com/wusaki0723/Aelios-resident/main/docs/setup-with-ai.md and follow it. Whenever I need to click something in the browser or enter a key myself, stop and tell me where. Talk to me in English.
```

### Set it up yourself in the dashboard

You need a Cloudflare account (the free plan is enough). For long-term memory, also have an Aelios already deployed. Telegram and WeCom are both optional and both set up on the settings page: without Telegram, skip step 1; WeCom is set up afterwards, see [WeCom (WeChat)](#wecom-wechat).

1. **Create the bot** (Telegram only): in Telegram, message @BotFather, send `/newbot`, choose a name and note the token.
2. **Deploy**: Cloudflare dashboard → Workers & Pages → Create → Import a repository, and pick this repository (or your fork). Name the project `aelios-resident`, the same as `name` in `wrangler.jsonc`, and keep the other defaults. From then on, every push to main updates it.
3. **Add the secret**: Worker → Settings → Variables and Secrets. Only `WEB_KEY` goes here; everything else, the bot token included, is set on the web.
   - `WEB_KEY`: the key to the web door, a long string you make up. Whoever has it can read the whole conversation and change every setting, so don't screenshot or share it; if you think it leaked, replace it here. Without it, an ordinary browser cannot get in; only the Telegram Mini App can.
4. **Fill in the settings on the web**: open `https://aelios-resident.<your-subdomain>.workers.dev/`, enter `WEB_KEY`, and tap **···** (settings) at the top right:
   - With Telegram: **Chat channels** (「聊天渠道」) → **Connect Telegram** (「接 Telegram」) → **bot token**: paste the token from step 1 and save. The resident checks it with Telegram and connects the bot to itself: the webhook, three commands, and the bot's bottom-left menu button that opens the web door. Then fill in the next step, **Who can talk to it on Telegram** (「谁能在 Telegram 上跟它说话」): your Telegram username, such as `@your_name`. Until this is filled in, it answers no one there. With both done, the Telegram card shows the bot's name and 「已连」 ("connected").
   - **Long-term memory** (「长期记忆」): your Aelios address and key. The key can be any one of `CHATBOX_API_KEY`, `IM_API_KEY` or `MEMORY_MCP_API_KEY` from your Aelios. Then, in the Aelios admin, create an identity for the resident and add the models you will use to that identity's main models. Put the identity's name under **More settings** (「更多设置」) → **Identity** (「身份」); left empty, the key's first identity is used.
   - Back in the chat, tap the line under its name at the top to pick a model. Tap its avatar at the top left, then the pen on the **Persona** (「人设」) card, to paste in a persona and save it.
5. Say something on the web door, or send the bot a message.

Set up before the bot token moved to the settings page, with `TG_BOT_TOKEN` and `TG_WEBHOOK_SECRET` in Cloudflare? That keeps working as it is, and `/tg/setup?secret=<TG_WEBHOOK_SECRET>` still connects it. A token saved on the settings page takes precedence over the one in Cloudflare.

## How it fits together

The whole resident is one Cloudflare Worker with one Durable Object, built on Cloudflare's [Think](https://developers.cloudflare.com/agents/).

- **No server to rent**: it runs on the free plan.
- **No database to set up**: the conversation, handoff letters, persona and stickers live in the Durable Object's built-in SQLite.
- **Everything is set on the web**: once it is deployed, you pick the model, write the persona and change every setting in the browser. A change applies from the next message.

```
Web door / Mini App ──────────────────────────▶ Worker /web/* ──┐
Telegram (optional) ──▶ Worker (secret, allowlist, commands) ───┤
WeCom (optional) ──▶ Worker (signature, decrypt, allowlist) ────┤
                                                                ▼
                    Resident (one Durable Object, one conversation)
       persona + chat rules + Aelios boot packet
       tools: memory, web search, web pages, stickers, voice, alarms, other MCP, cloud Claude Code
                                                                │
              replies to WeCom ──▶ relay on a machine with a fixed IP ──▶ WeCom API
```

- With Aelios connected, every turn goes through Aelios' model endpoint, which adds related memories and records the turn.
- WeCom only takes API calls from fixed IPs, so replies to WeCom go out through a small relay on a machine of yours (see [WeCom (WeChat)](#wecom-wechat)). Telegram and the web door need nothing else.
- 55 minutes after you go quiet: if the chat is long enough, it writes a handoff letter; if not, the heartbeat asks whether it wants to reach out.

## Using it

### The web door

Open the Worker's address and enter `WEB_KEY`. It is the same conversation as Telegram and WeCom: what you say there appears here within 5 seconds, and what you say on the web is answered only on the web, never sent to the other doors. Its buttons are small icons; hover over one, or press and hold it on a phone, to see its name (the names in 「」 below).

- **Saying something**: type, or tap **+** for pictures (up to 4 at a time, from the album or the camera), a handoff letter or another model; the smiley in the box opens your stickers. Hold the microphone to record a voice message (up to a minute); it is heard like one on Telegram.
- **Long-press** a message (right-click with a mouse) to quote it in your reply, copy it, save it to Aelios' **Precious** (「珍贵」), or have it read aloud (「念给我听」) once a voice provider is set.
- **Taking back its latest reply**: once its latest reply is done, long-press it (or right-click) and the menu also has 「重新生成」, which deletes it and has it answer your message again, and 「删掉」, which deletes it. Other messages' menus don't have these two. Use them when a reply came out as an error, garbled text or a flat refusal: it leaves the conversation, so it never sees it again. Only the latest reply can be taken back, so the prompt cache still holds. With Aelios connected, Aelios keeps its own record of what was said: delete that line under Today's chats on Aelios' admin page.
- **Searching the chat**: the magnifier at the top searches everything you and it have said, on any door, newest first, the chat a handoff letter folded away included. Tap a result to see the messages around it, and 「在聊天里看」 to jump to it while it is still in the chat. It finds the words as you typed them (letters in either case), up to 50 characters, as far back as the conversation itself reads (10,000 messages).
- **What it did**: its thinking and the tools it used are one dashed line under its reply, such as 「想了一下 · 忙活了 2 回」. Tap it for each step, and a step for its full arguments and result.
- **Cards**: pages it read and alarms it set (which you can move or delete there) show under its reply. A thread is one small card, under the newest reply about it (the one that sent it, then the one that reports on it): its title, how it stands, two lines of its report and a way into the thread, where the whole report and its links are. A thread that needs you to decide offers its answers as buttons.
- **Markdown**: its replies, a thread's reports and a thread's `.md` files show their bold, lists, tables, code and links. Nothing in them is ever read as HTML, and a link opens only an http(s) address.
- Messages it sent unasked are marked 「主动找你」, a model change shows as a line in the chat, and handoff letters appear, folded, where they put the older chat away. Each message shows its time, and the door it came in by when that is not the web.
- **Its page**: tap its avatar at the top left to change its picture and name, the model and the persona, and to see its memory, alarms, threads and usage.
- Night and day themes, or follow the system (at the bottom of settings). It works well on a phone.

**As an app with notifications**: on a phone, add the web door to the home screen (Safari: Share → Add to Home Screen; Chrome: Install app). Then turn on notifications from the card the chat shows, or under **Notifications** (「通知」) in settings. By default (`WEB_PUSH`) it notifies you when it reaches out, a thread finishes or an alarm rings and that message did not reach you on Telegram or WeCom, and when it answers on the web after you have left the page for 20 seconds. On iPhone and iPad, notifications work only from the home-screen icon (iOS 16.4 or later); in the Telegram Mini App there are none. The keys that sign the notifications are made by the first resident and stay in it, along with the list of devices that turned notifications on; the other residents sign with the same pair and send to the same devices.

### Telegram

- It answers private chats only, and only the people listed under **Who can talk to it on Telegram**.
- Several messages in a row are combined: it waits 3 seconds and answers them as one turn (`DEBOUNCE_SECONDS`).
- Replies are split at blank lines and sent piece by piece as they are written, with "typing…" shown in between.
- Each message carries your local time, so it knows what time it is.
- It sees the pictures you send (photos, or images sent as files, up to 20 MB). With Cloudflare Images (the `IMAGES` binding in `wrangler.jsonc`; free for 5,000 pictures a month) a picture longer than 1568 px on a side is scaled down to that before it goes to the model, which reads it at about that size anyway. Without Images, pictures go as they are, up to 3.75 MB (5 MB once encoded, the most Claude takes for one picture).

**Mini App**: tap the bot's bottom-left menu button and the web door opens right inside Telegram, without `WEB_KEY`. It lets you in by your Telegram-signed identity and checks it against **Who can talk to it on Telegram** every time, so removing someone from the list locks them out. If you move to a custom domain, open the settings page from the new domain and tap **Connect again** (「重新接一次」) on the Telegram card under Chat channels (Telegram only opens https Mini Apps). Details are in `src/mini-app.ts`.

**Commands**:

| Command | What it does |
| --- | --- |
| `/status` | The current model and persona, how long the conversation is, how many letters it has written, how much of the last turn came from the cache, and the state of stickers and voice |
| `/letter` | Shows the latest handoff letter |
| `/handoff` | Writes a handoff letter now, regardless of the token threshold, as long as there is older chat to fold (see [Handoff letters](#handoff-letters)) |

### WeCom (WeChat)

Optional. WeCom (企业微信) is Tencent's work messenger; a free enterprise of your own is enough, and with its WeChat plugin (「微信插件」) the same chat also reaches you in ordinary WeChat. The resident talks through a self-built app (「自建应用」) in that enterprise.

WeCom only accepts API calls from the app's trusted IPs (「企业可信 IP」), and a Worker has no fixed address. So the resident's replies go through a small relay on a Linux machine of yours that has one, such as a VPS. The relay opens no port: it listens on `127.0.0.1` and is reached through a Cloudflare Tunnel. What WeCom pushes to the resident goes straight to the Worker. The relay and how to install it are in [relay/wecom](relay/wecom/README.md) (in Chinese).

**Setting it up, in this order**:

1. **The relay**: on that machine, `sudo relay/wecom/install.sh` (add `--media` for voice messages; it installs ffmpeg), then give it a public hostname through a Cloudflare Tunnel, pointing at `http://127.0.0.1:8787`. Details in [relay/wecom](relay/wecom/README.md).
2. **The app**: WeCom admin (work.weixin.qq.com) → App Management (「应用管理」) → Create an app (「创建应用」). Make sure you are in its visible range (「可见范围」).
3. **The settings page** → **Chat channels** (「聊天渠道」) → **Connect WeCom** (「接企业微信」), step by step: the Corp ID (「企业 ID」, at the bottom of My Enterprise) and the app's AgentId and Secret; the relay address and relay key; and, after step 4 below, who can talk to it (your account (「账号」) in the WeCom contacts). Save each.
4. **Receiving messages**: on the app's page, Receive Messages (「接收消息」) → Set API Receiving (「设置 API 接收」). Paste the URL shown in the **Receive messages** (「接收消息」) step on the settings page (`https://<your resident>/messengers/wecom/webhook`), click Random (「随机获取」) for the Token and the EncodingAESKey, **save both on the resident's settings page first**, then click Save in WeCom. WeCom checks the address on that save, and the resident needs those two to answer it.
5. **Trusted IP**: on the same app page, add the relay machine's outgoing IP (`curl -s https://ifconfig.me` on it) under Trusted IPs (「企业可信 IP」). WeCom only lets you do this once the receiving URL is set.
6. Send it a message in WeCom. For WeChat: My Enterprise → WeChat Plugin (「微信插件」), scan the invite QR code with WeChat, and the app's chat shows up there.

The **WeCom** line of `/status`, and the WeCom card under Chat channels on the settings page, say what is still missing, whether the relay can be reached and whether it can do voice.

**What works**:

- Text both ways; pictures you send; voice messages both ways with `--media`. Without `--media` its voice replies go out as text, and it may not be able to hear yours.
- Stickers, as still pictures, once you turn on **Send stickers on WeCom** (「在企业微信上发表情包」; off by default). WeCom has no sticker message, only pictures, and it plays no animation and turns a see-through background black. So an animated GIF goes as a PNG of its fullest frame, what was see-through is filled with **Sticker background** (「表情包垫的底色」, `#EDEDED` by default, WeChat's light-mode chat grey, so the sticker looks set on the chat; pick dark mode's or type your own colour), and a small one is enlarged with its pixels kept sharp. PNG stickers are filled the same way, JPEG goes as it is, and Telegram's WebP and WebM stickers need `--media`. When off, the stickers it sends are left out there, and still show on the web and Telegram.
- `/status`, `/letter` and `/handoff`, as on Telegram.
- Check-ins, heartbeats, alarms and cloud jobs report to the chat you last wrote from, so if that was WeCom, they come to WeCom.

**Limits**: WeCom shows plain text, so Markdown is taken off (a link becomes its text and address); a reply longer than 2048 bytes is split; there is no typing indicator; a voice message is at most 60 seconds; WeCom lets an app send about 30 messages a minute to one person; stickers do not move.

### Choosing a model

Tap the line under its name at the top of the web door (it shows the model in use). A search box opens: the current, recent and common models are at the top, all available models below. Type `opus`, `kimi` or `qwen` to filter; a model that is not listed can be entered by its full id.

- **With Aelios connected**, the list below is Aelios' own model list: the models you chose in Aelios settings → Providers → Model list (`chatgpt/…` names, custom providers and `:floor` names are all here). If Aelios has no saved list, it hands over hundreds or thousands of upstream models; those are not listed one by one, only searchable. A model that is not among this identity's main models is marked 「记不住」 ("won't remember") and dimmed, since its chats would not be remembered, and it is refused at the trial call if you pick it. If Aelios cannot be reached, the picker falls back to the built-in catalog below and says why.
- **Without Aelios**, the list below is every text model in Cloudflare's model catalog.
- Before switching, it makes one trial call. If that fails (a typo, no balance, not in your plan), it keeps the current model and tells you why.
- With no model chosen, it uses `@cf/zai-org/glm-4.7-flash`, which works on the free plan.
- A purple dot runs on Workers AI itself, an orange dot uses AI Gateway credit, and a hollow dot goes through a relay.
- Write Claude models like `anthropic/claude-opus-5.5`. Every turn carries a cache marker, and the cache is kept for 1 hour by default (`CACHE_TTL`). Claude 5 and later think on every turn; a summary of the thinking shows under 「想了一下」. Set how long it thinks under **Thinking & letters** (「思考和交接信」).
- With Aelios connected, every model goes through Aelios, using the keys configured there. The exception is `claude-code/…`, which runs on your own Claude subscription (see [Your Claude subscription](#your-claude-subscription-claude-code)).

### Persona

Tap its avatar at the top left of the web door, then the pen on the **Persona** (「人设」) card. After you save, the next reply follows the new persona.

- The persona is stored in the Durable Object, not in the code, so a public repository never carries it.
- The last 10 versions are kept and can be restored with one click.
- **It can change its own persona** if you let it: switch on 「让它自己改」 (`PERSONA_EDIT`, off by default) on the persona page. It then gets one tool, `edit_persona`, to add to its persona or replace a piece of it. The change is saved like one of yours, applies from its next reply, shows as a line in the chat, and the version before it is among the earlier versions, so you can put it back. Each change rewrites the cache once on the next message.
- If you use the API key that comes with Max, keep the words "Claude Code" out of the persona.
- The resident's built-in chat rules, letter prompt and check-in prompts are written in English and assume nothing about who you are or your gender. It chats in the language the persona is written in.

### More than one resident

One Worker can house several residents, each with its own persona, model, settings, conversation, stickers, alarms and Telegram bot. Their avatars sit in a column on the left of the web door (on a phone, tap ☰ at the top left); tap one to switch to it. The **+** at the bottom makes a new one: give it a name and an id (lowercase letters, like `mochi`). A dot on an avatar means that resident said something since you last had it open.

- **The first resident** stays exactly as it was: same address, settings and bot. If you never make another, nothing changes.
- **A new resident's addresses** are under `/r/<id>`: its web page is `/?r=<id>`, and its Telegram webhook, WeCom message URL, thread reports and MCP sign-ins all carry that part. The resident fills them in itself.
- **Memory**: it shares the first resident's Aelios address and key, speaks as the Aelios identity named after its id (`/<id>/`) and keeps its memories in that identity's space. Create the identity in Aelios' admin page and give it its main models; change the identity on its settings page under Long-term memory. The key must be Aelios' main key, `CHATBOX_API_KEY`: the other keys read and write only the default space, where two residents' memories would mix.
- **Settings it never takes from Cloudflare**: the Telegram bot token, the WeCom app (AgentId, Secret, Token, EncodingAESKey), the claude.ai scheduled task's trigger URL and token, the Aelios identity and space, its name, and check-ins and heartbeats (a new resident does not reach out until you turn it on). The Cloudflare variables for these are the first resident's only. Everything else (providers, the Claude box, search, voice, the GitHub token, the time zone, who may talk to it) follows Cloudflare until set on its page.
- **Its own bot**: make another bot with @BotFather and paste its token on the new resident's settings page under Chat channels → Telegram. It connects the bot to `/r/<id>` itself, and the bot's menu button opens the Mini App on it. For WeCom, make another app and use the message URL shown on its settings page.
- **Notifications**: the whole web door has one key pair and one list of devices, so a device that turned notifications on once, on any resident's page, gets every resident's, and tapping one opens that resident. Turning them off on one page turns them off for all.
- **Deleting one**: open its page (tap its avatar), then **Delete this resident** (「删除这个住户」) at the bottom, and type its id to confirm. Its conversation, settings, stickers and alarms are deleted and its bot is let go; its memories in Aelios stay. It is off the list at once, but its id stays taken until everything is wiped; if wiping fails, it is tried again a few minutes later. The first resident cannot be deleted. Up to 8 more besides the first.

**Group chats**: with two or more residents, the column under their avatars has a **新群聊** (New group) button. Make as many groups as you like (up to 20), each with the residents you tick, and give each a name (or leave it empty for the members' names). Each group has its own icon in the column. Group chats are on the web door only, not in the Mini App, on Telegram or on WeCom.

- **Who answers**: say something and the group's members answer in the column's order, each hearing the ones before. `@` a name to call only that one; tap an avatar under the box to put its `@` in. Residents do not `@` each other; instead, once everyone has had a turn, those with something new to hear go round again, for at most 3 rounds on one message of yours (1 to 5 in the settings). Each is told which round it is and that it can reply SKIP to end; a round in which no one says anything ends it.
- **Like the chat**: a reply in several messages shows as several bubbles, in Markdown. You can send pictures (up to 4 at a time) and stickers from the packs of the resident whose page you came from; residents' stickers show too. Each member is handed the pictures with the words, and reads a sticker as what it means. Files cannot be sent, as in the chat.
- **It goes into their own conversations**: when a resident's turn comes, everything said in the group since it last spoke there is handed to it as one message in its own conversation, each line after who said it, and it answers there, with its own persona, model, tools and memory; its answer is posted to the group. So it knows what the group talked about, Aelios recalls for it and records it as usual, and you can bring it up later in private. The group's messages show only on the group's page, not in its private chat, and are not pushed to your phone. It is shown at most the latest 60 messages it has not heard.
- **Stop**: the square button at the top stops everyone still to answer, and no new round starts. The one answering already finishes, since its answer is in its own conversation anyway.
- **Settings** (the sliders icon at the top): the icon (tap it to pick a picture; it is public like an avatar), the name, who is in it, who answers when you `@` no one (everyone, one of them in turn, or no one), in what order (the column's, or shuffled), how many rounds, and **删掉这个群** (Delete this group). Deleting a group deletes what was said in it, its pictures and icon; what its members heard stays in their own conversations.
- The groups and what is said in them live in the first resident; each resident's usage timeline shows its group turns as 「群聊」.

### The settings page

Tap **···** at the top right of the web door. It opens on a list of sections in four groups: Long-term memory (「长期记忆」), Chat channels (「聊天渠道」, Telegram and WeCom) and Notifications (「通知」); Voice (「语音」), Stickers (「表情包」), Search & web pages (「搜网和读网页」), Background help (「后台帮忙」) and Other tools (「别的工具（MCP）」); Reaching out & alarms (「主动找你和闹钟」); Thinking & letters (「思考和交接信」) and Providers (「供应商」). A short line beside each shows its current state. Open one to see only that section; the explanation of a setting is behind the **?** beside it, and settings you rarely change are under **More settings** (「更多设置」). Telegram and WeCom are set up as numbered steps: the step to do is open, finished ones fold away with a summary.

- Click **Save** (「保存」) and the change applies from the next message.
- Where a value comes from: a value saved here wins; otherwise the Cloudflare variable of the same name; otherwise the default, which is shown in grey in the input box.
- The tag beside each item: 「已存」 means saved here, 「Cloudflare：<name>」 means it comes from Cloudflare, 「要填」 (amber) means it still needs a value.
- Keys can be entered but never read back.
- The button that locks the web door is at the bottom of the page.

### The usage timeline

On its page (tap its avatar at the top left), tap **Usage** (「用量」).

- On top, three totals: today, the last 7 days and the last 30 days, counted in your time zone (`TIME_ZONE`). Each shows the cost, the number of calls, the cache hit rate (the share of input read from the cache) and the tokens in and out.
- Below them, every call to a model, newest first: when; what it was for (a chat turn and the door it came in on, the handoff letter, a check-in, a heartbeat, an alarm, a cloud task's report, shrinking a web page, saving what a search found, the trial call when you pick a model); the model; the tokens (new input, cache read, cache write and whether it went to the 1-hour cache, output and how much of it was thinking); the tools it called; and the cost. A turn that calls tools makes one row for each call to the model.
- Only numbers and tool names are kept, never a word of the chat. Rows older than 90 days are deleted.
- The cost comes from Anthropic's published prices, built into the code and matched on the model's name, whatever prefix Aelios or a relay puts on it. It is what the call would cost on Anthropic's own API: a plan's included credit, a relay's own rates, a cloud platform's prices or a discount can differ. A model that is not Claude has no price: its tokens are shown, and the totals say how many calls were left out of the cost. A price added in a later version also prices older rows.
- The tokens are what the provider reported. A provider or relay that does not report cache writes shows none; one on the OpenAI format reports cache reads only.

## Features in detail

### Long-term memory (Aelios)

With Aelios connected, the chat goes through Aelios' own model endpoint (`https://<Aelios>/<identity>/v1`), the same way other chat apps connect to Aelios:

- Aelios uses your message to recall related memories, attaches them after your message for the model to see, and then records the turn. Recalled memories are visible in that turn only.
- Claude goes through the Messages API with the cache marker on your message, so the earlier conversation is still read from the cache.
- The model also gets 7 memory tools: search, remember a line, keep a precious moment, archive, learn a private word, read the diary, and the notebook. The notebook holds pages in Aelios that are read and written by name, good for things like study progress (what is done, what is weak, what is next). Pages are never recalled automatically, never changed by the nightly tidy-up and never expire; you can view, edit and clear them in the Aelios admin under More → Notebook. The notebook needs an Aelios version that has it.
- Aelios' boot packet holds only the latest day's diary and goes into the system prompt. Precious quotes and private words are left out, because Aelios attaches the ones related to your message on every turn.
- The boot packet is fetched again only when the cache has to be rewritten anyway: after a silence longer than the cache lifetime (`CACHE_TTL`), or right after a handoff letter. During a continuous chat it stays the same, so a diary update never breaks the cache.
- Letters, check-ins and the trial call when switching models are not your words; they are marked as such, so Aelios does not record them as yours.
- After a turn that searched the web, it picks up to 3 facts that will still hold in a few months and saves them as world knowledge in Aelios, so it need not search again. To turn this off, switch off 「搜到的知识存进 Aelios」 (`WEB_LEARN`).

Without Aelios it still works, but it remembers only the current conversation and its letters.

### Handoff letters

A handoff letter is a letter it writes to its later self. Once the letter is written, the older chat is folded out of the model's input and only the most recent part is kept word for word. The original messages stay stored in the resident; nothing is deleted.

**When it writes one by itself**: only when both of these hold.

1. The chat it currently carries is estimated at `LETTER_TOKEN_THRESHOLD` tokens or more (default `30000`).
2. It has been quiet for `LETTER_IDLE_MINUTES` (default 55 minutes) since your last message, or since the last alarm turn that completed.

While you keep chatting, passing the threshold does not trigger a letter right away.

- Change the threshold under **Thinking & letters**; it takes whole numbers above `8000`. To carry more chat before folding, use something like `50000`.
- The estimate covers the chat it still carries: old letters, tool calls and results, and images count; the persona, tool definitions and past thinking do not; it is not the total since the beginning. One Chinese character is about 1 token.
- The 55 minutes are there to write the letter before the 1-hour cache expires: the letter turn follows the original conversation word for word, so the whole prefix is read from the cache, which is cheap.
- If the quiet time is up but the chat is below the threshold, or there is nothing older to fold, it writes no letter; the heartbeat takes over (see [Reaching out to you](#reaching-out-to-you)).

**What stays after a letter**: the most recent ~8000 tokens of the original chat, counted back in whole question-and-answer rounds. If the latest round alone is over 8000 tokens, that round is kept whole, never cut. Everything earlier goes into the letter, the first few messages included. The 8000 only sets how much recent chat is kept; the letter, persona and tool definitions come on top, so it says nothing about the size of a whole request.

**What a letter contains**: seven sections — how they are, what happened between us, what got done, where we are right now, things we want to do, things we like, and what is unfinished. Whatever the previous letter left open is carried forward.

**Writing one by hand**: send `/handoff`. It ignores the threshold, but there must still be chat older than the recent part to fold. It tells you separately when there is nothing to fold, when writing failed, and when a letter is already being recovered. A failed letter never deletes the older chat, and it never starts a second letter while one is being recovered.

**After the letter**: the letter is saved in the resident and then sent to Aelios (not to Telegram, so you are not disturbed), and it stops there. The next quiet cycle starts with your next message, or with the next alarm turn that completes.

**How the cache is charged**: the letter turn adds no new cache marker — once the letter is written the older chat is folded away, so nobody would read a new one. It reuses the marker from the previous turn on your last message: on a hit the prefix is reused, and the small tail (its last reply, tool results and the letter prompt) is charged at the normal input price. If the provider's cache has in fact expired, that old prefix may be rebuilt, so zero cache writes are not guaranteed.

> The old setting `KEEP_RECENT_TOKENS` has been removed. Values saved for it on the web and the Cloudflare variable of that name are ignored; they are not converted into a letter threshold.

#### Letter status and sync retries

**Thinking & letters** shows two things separately:

- **Writing**: writing (`writing`), recovering (`recovering`), written (`written`), nothing to fold (`empty`) or failed (`failed`), with the time of the latest letter and any error. If the status itself cannot be read, that is shown separately and never mistaken for "nothing to fold". The status is reread when you open or save the settings, and you can click **Refresh status** (「刷新状态」).
- **Sync to Aelios**: the delivery state of the latest letter (pending, delivered, failed or paused), the number of attempts, when it was confirmed, and how many letters are pending, waiting to retry or paused.

Sync rules:

- A new letter is sent at once. After a failure it tries 5 more times, waiting 30 seconds, 2 minutes, 10 minutes, 30 minutes and 2 hours. After the last failure the letter and its job are kept and can be retried by hand.
- **Retry sync** (「重试同步」) appears only when letters for the current Aelios address and namespace have failed or are paused. It **only resends letters already written; it neither calls the model nor rewrites a letter**.
- If you remove the Aelios settings or change the address or `AELIOS_NAMESPACE`, letters bound for the old target are paused; they are never redirected to the new address or namespace. To deliver them to the old target, restore its settings and retry. Changing only the key does not change the target.
- "Delivered" means Aelios returned a receipt for saving the message, not that its background memory extraction has finished. Aelios' receiving endpoint does not deduplicate, so resending is "at least once": if a letter was in fact saved but the success reply was lost, a retry may leave a duplicate copy.

#### Limits on writing letters

- **Size**: a letter is written only if the letter-writing model can read everything being folded. Parts already folded count as their letter, not as the original images and attachments; if the whole effective history is over the ~32 MiB loading limit, no letter is written and the chat stays as it is.
- **Length**: the SDK reads back at most 10,000 messages along the conversation branch. Letters only cover older chat; they do not delete the original messages, so with long use the branch will eventually pass that number. After that:
  - Ordinary chat, `/status` and the web history still show the recent part, but the old letters can no longer be read; the conversation line of `/status` (「对话」) says so.
  - Writing a letter fails, with a message saying the branch is too long.
  - A letter that was already written but had not yet folded the chat is marked failed once and does not block later letters.
  - The real fix (for example, trimming the original messages a letter covers) has not been built yet.

### The cache and the history the model sees

So that the cache keeps hitting, the history already sent to the model does not change within one cache window: older tool results and images are not cut down just because a few more turns went by. The window boundaries are stored in SQLite and survive a Worker restart; no second copy of the chat is kept.

Only when a new window opens (the cache expired after a silence, or a letter folded the older chat) is it decided again what to shorten:

- older ordinary tool results become previews of at most 500 characters;
- older images and other media become a fixed text placeholder;
- the recent part and anything new in the window stay complete.

This changes only what is sent to the model; the stored messages, tool results and images are untouched. A letter is written from the previous turn's view, so anything already shortened to a preview is not expanded again for the letter — a handoff letter is not a complete backup of web pages or attachment details.

Changing the persona, switching models, deleting or branching messages, deploying a new version, changing something on the settings page, a change in upstream routing, or the history reaching the ~32 MiB loading limit can all force the whole cache to be rewritten, so a cache hit is never guaranteed.

### Reaching out to you

**Check-ins**: under **Reaching out & alarms** (「主动找你和闹钟」) → **Reach out** (「主动找你」), set times such as `every day at 09:00`, `every weekday at 21:30` or `every 3 hours`. At those times it considers whether to message you, and stays silent if it is not a good moment.

**Heartbeat** (`HEARTBEAT`, at most 3 per quiet period by default): when you have been quiet for 55 minutes and the chat is still below the letter threshold (or there is nothing to fold), it is asked whether it wants to reach out. If it does, the message goes to the chat you last wrote from, Telegram or WeCom (it always shows on the web page too); if not, nothing is sent. It is asked again every 55 minutes, up to the limit. Your next message, or an alarm turn that completes, starts the count again from 1.

- Normally each heartbeat comes within the 1-hour lifetime of the previous cache, so it costs about as much as one of your messages. Delayed scheduling, a changed prefix or an expired provider cache can still force a rebuild, so heartbeats are not free.
- When the threshold is reached, the quiet time is up and there is something to fold, it writes a letter and skips the heartbeat: after a letter the conversation has changed and the whole cache must be rewritten, so asking then would be expensive.
- Set the number under **Reaching out & alarms**: `0` turns it off, `10` is the maximum. Only models that use the Anthropic Messages cache get heartbeats, and not when the cache is set to 5 minutes or letters are turned `off`.
- **Quiet hours** (`QUIET_HOURS`, `00:00-08:00` by default, in your time zone): a heartbeat that falls in them is not asked, and the rest of that silence's count is dropped. It does not pick up again in the morning: by then the cache is cold and asking would cost the whole conversation. Your next message starts a new count. Set them under **Reaching out & alarms** with two hour pickers or a preset; `off` asks at night too. Check-ins, alarms and letters are not affected, since those run at a time someone chose.

**Alarms** (`ALARMS`, off by default): when on, it gets three tools — set an alarm, list alarms, cancel one. An alarm can ring in a few minutes, once at a set time, or on repeat, like `every day at 21:30`, `every weekday at 08:00`, `every week on sat,sun at 10:00` or `every 3 hours`. When it rings, it gets back the note it wrote and can message you or let it pass.

- Ask it to remind you and it sets one. In its own turns (a heartbeat, or a ring), an alarm must be at least an hour ahead. The heartbeat does not suggest setting an alarm, since later heartbeats will ask again anyway.
- Its alarms are listed under **Reaching out & alarms**, and on its page; **Move** (「改时间」) changes when one rings and **Delete** (「删掉」) removes it. The card under the reply that set an alarm has the same buttons. When you change the time zone, daily alarms follow the new zone.
- At most 10 alarms; a repeat at most once an hour; at most 24 rings a day for all alarms together.
- An alarm turn that completes (even with a `SKIP` reply) counts as new activity: it restarts the quiet timer and stops the old heartbeats; when the quiet time is up, it writes a letter if one is due, or starts the heartbeat. A failed alarm does not count. The ring is still a system note: it never poses as your words and does not change when you last spoke. Heartbeats and check-ins do not count as activity.

### Web search and web pages

- **Search** (`web_search`): with your own search keys on the settings page (Tavily, Brave, Perplexity — any of them), it uses them in that order and moves on when one fails or runs out; with none, it uses Cloudflare's Web Search, which takes a little AI Gateway credit per search.
- **Reading pages** (`web_fetch`): reads a page as Markdown; it can open search results and links you send. It follows the approach of [web-fetch](https://github.com/sakisakisa-design/web-fetch), built into the resident, so there is nothing else to deploy.
  - Local and private-network addresses are never read, and every redirect is checked before it is followed.
  - Pages that need JavaScript to show anything are read with Cloudflare's browser.
  - A page read once is kept for 1 hour, so asking again does not fetch it again.
  - Long pages are first condensed by a cheap model (`WEB_FETCH_MODEL`, Workers AI's Qwen3 30B by default); with a question, only the relevant passages are kept.
  - Old encodings such as GBK are recognised.
- **Sites with keys** (「带钥匙的网站」): under **Search & web pages**, store a key for a site, the same idea as a cloud environment's network secrets. Every request to that site carries it automatically; the model never sees the key; other sites (including redirect targets) and plain http never get it. Up to 10 sites.
  - A key is entered as rows: a header name on the left, its value on the right; click ＋ for another row. The buttons 「Cloudflare 门禁」 (Cloudflare Access) and 「一串 token」 (a token) fill in the names for you, so you only paste the values.
  - **A site behind Cloudflare Access**: in Zero Trust → Access controls → Service credentials → Service Tokens, create a service token (the Client Secret is shown only once, so copy it then). Give the application a policy whose action is "Service Auth" and that includes the token. On the settings page, click 「Cloudflare 门禁」 and paste the Client ID and Client Secret into their boxes (pasting them together with the names in front also works). See [Cloudflare's guide](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/). With no key or a wrong one, it says Access blocked it instead of reading the login page as content.
  - **Files in a private GitHub repository**: create a fine-grained token with only the repositories it should read and read-only Contents. Enter `raw.githubusercontent.com` as the site, click 「一串 token」 and paste the token (it is sent as `Authorization: Bearer`). Then ask it to read `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>`. For a private repository the token does not cover, GitHub answers 404 rather than 403, and it reminds you the key may not see that repository.
  - Pages that need a key are never read with the browser (the browser cannot carry the key). Saving, changing or removing a key clears all pages read so far (redirected ones included). The change applies from the next message, and that message rewrites the cache once, because the tool description lists the sites that have keys.

### Voice messages

**Hearing** is always on. A voice message (or audio file) you send on Telegram or WeCom is transcribed first; the model sees `[voice 0:12] what you said`, and asks you to say it again if it could not make it out. It uses Workers AI's Whisper; when ElevenLabs is the voice provider, it uses ElevenLabs Scribe instead and falls back to Whisper on an error. A voice message recorded on the web door (hold the microphone) is heard the same way. The web door shows each one as a voice message with its length and what was heard; the ones recorded there can be played back.

**Speaking** turns on only when you pick a provider under **Voice** (「语音」). With none, it sends no voice, and not a word about voice is added to its prompts.

| Provider | Good for |
| --- | --- |
| ElevenLabs | Its voices, including ones cloned in your account |
| Cartesia | Its voices, including cloned ones |
| OpenRouter | MiniMax, Gemini, OpenAI, Fish and more, all with one key |

- All three go through the resident's AI Gateway. If the key is stored in that Gateway's Provider Keys (alias `default`), you need not enter it on the settings page; which Gateway is used is under **Providers** → **AI Gateway name** (「AI Gateway 的名字」).
- **When to send voice** (「什么时候发语音」): only when you sent voice (default), every reply, or when it chooses to. Unless it is every reply, it has a `send_voice` tool.
- On the web door, a reply comes with its voice by the same rule (after a voice message you recorded there, or every reply), and any reply can be read aloud from the long-press menu (「念给我听」). The voice is kept with the message, so it plays again without being made again. Every voice message it sends to Telegram or WeCom (a reply said aloud, `send_voice`, a check-in) shows on the web page too, with the reply it says; `send_voice` works with no Telegram or WeCom at all, on the web page alone.
- It learns the laugh, sigh and pause notation of the provider and model you pick, such as `[laughs]` for ElevenLabs v3 and v4, `[laughter]` and `<speed ratio="0.9"/>` for Cartesia, `(laughs)` for MiniMax and `<laugh>` for Gemini. To make it speak more slowly, say so in the persona and it adds the marks itself.
- Links, Markdown and emoji are removed from what is spoken; for a reply with links, the links follow as text after the voice message.
- If a voice message cannot be sent (a provider error, over 2000 characters, or the recipient does not accept voice), it sends text as usual and `/status` says why.

The code is in `src/voice.ts`. Phone calls (live voice) are not built yet.

### Stickers

Import them under **Stickers** (「表情包」) and it sends one now and then while chatting: at most one per reply, and none when you are upset or talking about something serious.

- **How it sends one**: the list of its stickers is in the system prompt, and it writes `[sticker: pack/name]` in its reply. The mark is taken out of its words and the sticker goes right after the paragraph it was in, on Telegram, WeCom, the web and in group chats. A sticker costs no extra call to the model, as a tool would. A name it does not have is just taken out.

- **Import**: paste a Telegram sticker pack link (`t.me/addstickers/…`), upload a zip, or paste a zip's address. Stickers from a Telegram pack come with only an emoji; fill in **When to use** (「什么时候用」) for the ones you like, so it knows when to send them.
- **Drawing its own**: pixel art, small animations of up to 8 frames, outlined in white automatically, saved to its own pack, "mine". A new drawing joins its sticker list only from the next cache window (after a silence longer than the cache lifetime, or after a letter), so the system prompt does not change and rewrite the whole cache; until then it can still send it by name.
- On the settings page you can turn the whole feature or each pack on and off, delete packs or single stickers, and edit **When to use**. Changes apply from the next message (which rewrites the cache once).
- The name and **When to use** of every sticker in the enabled packs go to the model on every turn, so at most 200 stickers in 20 packs are sent; each pack shows roughly how many tokens it costs.

<details>
<summary>The zip sticker pack format</summary>

One zip, at most 16 MB, at most 40 MB unpacked. The simplest way: put the images in, and each file name says when to use it, such as `happy.gif` or `miss-you.png`. Images can be GIF, PNG, WebP or JPEG, at most 1 MB each; a `.webm` with the same name next to one (a Telegram video sticker) is what gets sent on Telegram.

For more detail, add a `pack.json`:

```json
{
  "format": "resident-stickers/1",
  "id": "clawd",
  "name": "Clawd",
  "description": "One line about this pack",
  "author": "Who drew it",
  "license": "How it may be used",
  "homepage": "https://…",
  "stickers": [
    { "id": "love", "file": "love.gif", "telegram": "love.webm", "emoji": "❤️", "when": "A rush of love: they said something sweet." }
  ]
}
```

- `file`: the image shown on the web, relative to the folder that holds `pack.json`.
- `telegram` (optional): the file sent as a real sticker on Telegram — WebM (VP9, 512 px, up to 3 seconds, at most 256 KB), WebP (at most 512 KB) or TGS (at most 64 KB); only a transparent background stays transparent. Without it, a GIF is sent as an animation and a still image as a photo.
- `id`: the model calls it `<pack id>/<id>`; the file name is used if left out. `emoji`: one emoji, which Telegram needs when the sticker is uploaded. `when`: when to use it, up to 160 characters, in any language.
- `homepage` must be https; it shows as the **Source** (「出处」) button on the settings page.
- Importing a pack with the same `id` again replaces the old one and keeps its on/off state. A pack holds at most 120 stickers, and every sticker that cannot be imported says why.

Custom emoji packs (`t.me/addemoji/…`) cannot be sent by bots and are not accepted.

</details>

### Other MCP servers

Enter a server's address (https) under **Other tools** (「别的工具（MCP）」), and its tools work from the next message.

- For a server that needs signing in, click **Authorize** (「去授权」). For one that needs a key, enter the key there; it is sent as `Authorization: Bearer` by default, or written as `x-api-key: your-key` it goes into that header instead.
- You can also say "connect https://…" or "disconnect …" in the chat and it does it itself. Don't send an address that contains a key in the chat (the chat is recorded in Aelios); connect those only on the settings page.
- It acts only in a turn that you started yourself: if that turn has already read a web page, searched the web, opened a thread's file or called another MCP server, it does not connect, so that a "connect …" on some web page cannot decide for you.
- Tool descriptions go to the model on every turn, so they are shortened; at most 8 servers, at most 40 tools per turn.
- When the resident wakes from sleep, connected servers take a few seconds to come back. One that has not reconnected yet keeps its last tool list (a call to it just waits a little longer), so the tool list does not change and the cache is not broken.

### Background help

Off by default. Once turned on under **Background help** (「后台帮忙」), when you ask it to dig through lots of material, write something, make a page or change code, it writes the work up as a job and hands it to a **thread**, and keeps chatting with you. None of the intermediate steps use the chat's context or break its cache. When the thread is done, the resident tells you in its own words.

A thread can run in three places:

- **On the resident itself** (nothing else to set up, no Claude subscription needed): each thread has its own conversation and files. It can search the web, read pages, use long-term memory, the notebook, connected MCP tools, and read and write its own files. It has no shell, so it cannot install or run anything.
- **GitHub Actions** (for running commands, tests and opening pull requests): a full Linux machine, in a private repository the resident makes on your GitHub account. All it takes is one token.
- **A claude.ai routine** (with a Claude subscription): each job opens a cloud Claude Code session on your plan. Once connected, jobs go there by default; light reading and writing can still stay on the resident's own threads.

Threads on the resident and on GitHub Actions work on **the threads' model**: Workers AI's `@cf/zai-org/glm-4.7-flash` (within its daily free allowance) unless you pick another under 「线程用哪个模型」 (`CLOUD_TASK_MODEL`). They never use the chat's model on their own, so a costly chat model is not spent on legwork.

The **Threads** (「线程」) button at the top of the chat (also on its page) lists every thread. Open one to see:

- What the resident asked, the steps the thread took, and what it handed back. A follow-up job belongs to the same thread, and a thread on the resident carries on with its earlier conversation and files.
- Its files: text and pictures show as they are, an HTML page shows in an isolated frame (its scripts cannot reach the resident's page or sign-in), and every file can be downloaded.
- When it needs you to decide, its card in the chat can offer the answers as buttons. The one you tap goes to the thread (on the resident) or to the resident, and the card says what you picked.
- A box to write to the thread directly (say, "make the title shorter"). That goes to the thread alone, not through the resident, and does not count toward the daily limit.

You do not have to keep track of threads yourself. Bring up earlier work in your own words ("carry on with last week's page", "what did that research say?") and the resident finds it. With background help on it has one more tool, `find`, used only when the talk turns to earlier things, so nothing is added to every turn. It does three things:

- **Finding threads**: a few words find the threads that have any of them, in what each was asked, what it reported, its links or the names of the files it made, the ones with more of the words first; with no words, the newest. A day or a few days (`2026-10-27`, `2026-10-20..2026-10-26`, in your time zone) keeps only the threads active then, so "the one from the 27th" or "last week" finds it. Each comes with its id, and carrying on with one goes on from that thread's newest job, whichever of its jobs it was named by.
- **Reading a thread's file**: a text file a thread on the resident made, up to 16,000 characters. Like a web page, it is read as information, and no job goes out in a reply after it.
- **Searching the chat**: your conversation, the part a handoff letter folded away included, searched for exact words the same way the magnifier does, and the messages around a hit.

**Roles** save the resident writing the same instructions into every job. Three come with it, under background help on the settings page: `coder` (follows the repository's own rules on a new branch; for a bug, finds the root cause and writes a test that fails first, and stops after three failed tries; runs typecheck and tests itself before it says it is done, then opens a PR; never merges, pushes to the default branch or deploys), `reviewer` (reads only, runs the tests, reports only what it is fairly sure of and leaves out old problems, what a linter would catch and taste; sorts it into must fix, should fix and nits with file, line, why it matters and how to fix, and ends with whether it can be merged) and `researcher` (plans first, prefers first-hand sources and says when it leans on weaker ones, writes down where sources disagree, gives a source for each point and marks what it is unsure of). They draw on well-tried agent skills ([superpowers](https://github.com/obra/superpowers)' debugging, test-first and verify-before-done; Anthropic's code-review plugin and research subagent), kept short. A role you never changed gets the new wording when the resident updates; one you changed stays yours. You can change them, remove them and add your own, and pick each one's model from a list: threads on the resident and on GitHub Actions use the role's model (on claude.ai your subscription's model does the work). The resident names a role in `cloud_task` (its `role`, not another tool); the role's instructions go before the job, and a follow-up keeps its thread's role.

It can also hand you a file instead of a long text you would have to copy on a phone: a plan, a document, a list, a table. That is one more tool, `make_file` (at most 3 files a reply). The file goes to the chat you wrote from (a document on Telegram, a file on WeCom) and shows under the reply on the web page, where you can open and download it. Files are kept with the voice messages and go when those do, the oldest first.

With background help off the resident has none of `find`, `make_file` or `cloud_task`: one kept just for chatting stays as it was. The descriptions never change, so connecting or disconnecting a place does not break the cache.

Connecting GitHub Actions:

1. On the settings page, under Background help, tap **Make a GitHub token** (「去 GitHub 生成 token」). It opens GitHub's page for a classic token with `repo` and `workflow` already ticked: scroll down, click **Generate token**, and paste it into **GitHub token** on the settings page (never in the chat).
2. The resident makes a private repository `resident-hands` on your account and puts its workflow in it. The settings page then shows the repository; if the token cannot do that, it says what is missing.
3. Tap **Try it** (「试一下」) next to it.

Nothing is stored on GitHub: each run fetches `hands.mjs` from the resident, calls the model through the resident (the threads' model, with the resident's own keys; the calls show in the usage timeline as the threads' work), and borrows the token for that run to clone, push and open pull requests in your other repositories. Keep `resident-hands` private: a run's log and files can be seen by whoever can see the repository, and the resident will not use it once it is public. Each job gets a fresh machine; the job is read from the run's event file, not printed in the log, and the codes show as `***`. Files it makes come back to the resident: they show on the thread's report and in its file list on the web page, to open or download (up to 10 MB each, 50 MB a job; a bigger one stays in that run's artifact for 30 days). To publish pages publicly, add the Actions variable `HANDS_PUBLISH_REPO` (`owner/repo`) in `resident-hands` and turn on GitHub Pages in that repository (Deploy from a branch → gh-pages → / (root)); it publishes only when the job asks for a public page. A model call that times out or gets a server error (5xx) is tried once more before the job is marked failed. A run that times out or crashes tells the resident it stopped, so you do not wait 3 hours for nothing.

The first time you connect a claude.ai routine (the settings page shows the same steps and the prompt to copy under 「怎么接」):

1. Open [claude.ai/code/routines](https://claude.ai/code/routines), create a routine, paste in the prompt from the settings page, and choose the model, repository and cloud environment.
2. Under the trigger, add an API trigger, copy its URL and click "Generate token". Enter the URL on the settings page; enter the token there too, or store it as the Cloudflare secret `CLOUD_TASK_TOKEN`. The token is shown only once; don't send it in the chat.
3. In the cloud environment that routine uses, set network access to Custom and add the resident's domain (such as `xxx.workers.dev`) to the allowed sites; otherwise results cannot come back.
4. Click **Try it** (「试一下」). When the job turns 「做完了」 (done) a few minutes later, it is connected.

Wherever it runs:

- Under the reply that sent a job there is a small card (sent, working, done, waiting for you, failed, no reply). **Open thread** (「打开线程」) shows the details; jobs on GitHub or claude.ai also have **Open session** (「打开会话」), and a claude.ai session can be continued there, with a new result reported back again.
- A job that needs a shell goes to GitHub Actions or claude.ai, whichever is connected (with both, the resident picks). Connecting or disconnecting either one does not change what the chat's model is told about background help, so it does not rewrite the chat's cache.
- A job contains only the work itself, not the conversation or anything private. The thread starts out knowing nothing, so the resident writes the job out in full.
- Jobs are sent only in a turn you started yourself; not if that turn has read a web page, searched the web, opened a thread's file or called another MCP server. At most 3 jobs per reply and 10 per 24 hours.
- One exception, for work you already asked for: when a thread reports back done or failed, the resident may carry that same thread on right away (to fix or finish it) without waiting for you, at most twice in a row. Nothing new goes out from a report, and once it has carried on twice, the thread waits for you.
- A report that comes back while the resident is answering you is kept and waits until that reply is done; it is told once.
- Results that come back are treated as information, not as instructions. Each job has its own one-time code; nothing without it is accepted, and it expires after 7 days.
- On GitHub and claude.ai it works on a new branch and opens a PR, and never pushes to the default branch, deletes anything or spends money unless the job says so.
- Only the newest 200 jobs are kept; a thread on the resident whose jobs are all gone is deleted with its files. Until then its files stay, with no time limit, in the resident's Durable Object storage on your Cloudflare account, and count toward its SQLite storage (5 GB in all on the free plan; on the paid plan 5 GB-month included, then $0.20 a GB-month). A thread that ran on GitHub Actions or claude.ai keeps its files there; the resident keeps only its report and links.
- If no result comes back within 3 hours (longer for a job that keeps reporting progress, up to 12 hours), it tells you, with the link.

On GitHub and claude.ai, a follow-up starts afresh with the earlier result as context. The Anthropic trigger API is still in preview and has hourly trigger limits.

### Providers: your own keys and relays

With Aelios connected, the chat's models and keys are configured in the Aelios admin; this section only covers requests the resident sends itself.

- **AI Gateway name** (`AI_GATEWAY_ID`, `default` when empty): search, voice and, without Aelios, the models all go through this Gateway, and keys are looked up only in its Provider Keys.
- **Your own Anthropic key**: store one in this Gateway → Provider Keys with the alias `default`, and `anthropic/…` models use it instead of Cloudflare's unified billing.
- **A relay** (OpenRouter, Nous and the like): enter the relay's address (up to `/v1`) and key, and write the model as `custom/` plus that service's own model name, such as `custom/anthropic/claude-sonnet-5.5`. It calls in OpenAI's format by default; if the service speaks Anthropic's Messages format, choose `anthropic` as the format and cache markers are sent too. This path does not go through AI Gateway, so it does not show in the Gateway's logs.

### Your Claude subscription (`claude-code/…`)

The chat can run on your own Claude Pro or Max plan instead of an API key: write the model as `claude-code/` plus the Claude model's id, such as `claude-code/claude-opus-5-5`. Each turn then goes to the Claude box (`claude-box/`), a small server that runs the official Claude Agent SDK signed in with your `claude setup-token`, on a machine of your own behind a Cloudflare Tunnel. Everything else stays the resident's own: the conversation, persona, letters, heartbeats, channels and tools.

- **A machine for the box**: Google Cloud's free e2-micro is enough. In Cloud Shell, `bash claude-box/gcp.sh --hostname claude-box.<your domain>` makes one with IPv6 only (no IPv4 address to pay for) and installs the box and its tunnel; on any other Linux machine with systemd, `sudo claude-box/install.sh --tunnel`. The machine has to reach `api.anthropic.com`, so not one in mainland China or Hong Kong. Step by step, also for an AI to follow: [docs/claude-box.md](docs/claude-box.md) (in Chinese).
- **On the settings page**, under **Providers** (「供应商」): the `sk-ant-oat…` that `claude setup-token` prints on your computer, the box's address (the tunnel's hostname) and the box key the install made. Secrets are never shown again; clear them there to sign out.
- **Tools work as on any model**: Claude Code calls the resident's tools, the reply stops there, the resident runs them, and the same Claude Code in the box goes on with the results. Claude Code's own tools (commands, files, the web) stay off. With Aelios connected, the resident also recalls for each of your messages and records each exchange in Aelios itself, since these turns do not go through Aelios' model endpoint (so Aelios' model list does not apply to them).
- **The box keeps nothing**: each turn carries the whole conversation; what the box answered before goes back as Claude Code's own record of it, kept in the Durable Object, so the prompt cache keeps hitting from turn to turn, and a box that restarted carries on.
- It is your plan and your account: one setup token is for one person's own resident.

## All settings

Everything is changed on the settings page, except `WEB_KEY` (a Cloudflare secret) and `TG_BOT_USERNAME` and `DEBOUNCE_SECONDS`, which are set in Cloudflare if at all.

| Variable | Default | What it does |
| --- | --- | --- |
| `TG_BOT_TOKEN` | empty (no Telegram) | The bot token from @BotFather. Saved on the settings page, it connects the bot by itself; one in Cloudflare (with `TG_WEBHOOK_SECRET`) is connected with `/tg/setup` |
| `TG_ALLOWED` | empty (answers no one) | Who can talk to it on Telegram: @usernames or chat ids, comma-separated |
| `TG_BOT_USERNAME` | empty | The bot's username; not needed, the resident asks Telegram |
| `WECOM_ALLOWED` | empty (answers no one) | Who can talk to it on WeCom: members' accounts (「账号」), comma-separated |
| `WECOM_CORP_ID` / `WECOM_AGENT_ID` / `WECOM_SECRET` | empty | The enterprise's Corp ID, and the self-built app's AgentId and Secret. All of WeCom empty means the WeCom door is off |
| `WECOM_TOKEN` / `WECOM_AES_KEY` | empty | The app's Receive Messages Token and EncodingAESKey (43 characters); save them here before saving the URL in WeCom |
| `WECOM_RELAY_URL` / `WECOM_RELAY_KEY` | empty | The address of the [relay](relay/wecom/README.md) through its Cloudflare Tunnel, and its key (at least 32 characters) |
| `WECOM_STICKERS` | `off` | `on` sends stickers on WeCom too, as still pictures (an animation's fullest frame) |
| `WECOM_STICKER_BACKGROUND` | `#EDEDED` | What a see-through sticker background is filled with on WeCom, which would turn it black: a colour like `#111111`, or `none` |
| `RESIDENT_NAME` | `住户` | Its name on the web door, the home-screen icon and notifications, at most 20 characters; changed by tapping the name on its page. The persona is what it calls itself in the chat |
| `WEB_PUSH` | `on` | Notifications on the devices that turned them on: `on` sends what did not reach you on Telegram or WeCom (it reached out, a thread finished, an alarm rang) and answers on the web after you left the page; `always` also what went to Telegram or WeCom; `off` none |
| `TIME_ZONE` | `Asia/Singapore` | The time zone for message times and schedules |
| `DEBOUNCE_SECONDS` | `3` | Messages sent within this many seconds count as one turn |
| `CHECKIN_SCHEDULE` | empty (no check-ins) | Times like `every day at 09:00`, `every weekday at 21:30`, `every 3 hours` |
| `HEARTBEAT` | `3` | When the quiet time is up but the chat is below the letter threshold (or there is nothing to fold), ask whether it wants to reach out, then again after each further quiet time, at most this many times per silence. `0` turns it off, `10` at most |
| `QUIET_HOURS` | `00:00-08:00` | Hours in `TIME_ZONE` when the heartbeat does not ask; hours past midnight such as `23:00-07:00` work. `off` for none |
| `ALARMS` | `off` | `on` lets it set its own alarms to come back to you, at most 10 |
| `PERSONA_EDIT` | `off` | `on` lets it change its own persona with `edit_persona`; switched on the persona page |
| `AELIOS_URL` / `AELIOS_API_KEY` | empty | Long-term memory; when empty, Aelios is not used and the chat does not go through it |
| `AELIOS_NAMESPACE` | `default` | The memory space for the memory tools, boot packet and letters; it must match the identity's space in Aelios. All three keys read and write `default`; only `CHATBOX_API_KEY` can use another |
| `AELIOS_IDENTITY` | empty (the key's first identity) | Which Aelios identity the chat goes through; the model you use must be among its main models |
| `LETTER_TOKEN_THRESHOLD` | `30000` | The letter threshold (estimated tokens of the chat it carries), a whole number above `8000`. A letter also waits for the quiet time; afterwards the latest ~8000 tokens of chat are kept word for word |
| `LETTER_IDLE_MINUTES` | `55` (`4` with `CACHE_TTL=5m`) | Minutes of quiet before an automatic letter, at most 1 minute less than the cache lifetime; `off` leaves only `/handoff` |
| `CACHE_TTL` | `1h` | How long Claude's cache is kept: `1h` or `5m` |
| `THINKING_EFFORT` | `auto` | How long Claude thinks: `low`, `medium`, `high`, `xhigh`, `max`; `auto` uses the model's own default. Claude only; the first message after a change rewrites the cache once |
| `WEB_SEARCH` | `on` | `off` turns search off; `ceramic`, `exa` or `linkup` picks which Cloudflare Web Search backend to use once your own keys have all failed |
| `TAVILY_API_KEY` / `BRAVE_API_KEY` / `PERPLEXITY_API_KEY` | empty | Your own search keys, used in this order |
| `WEB_FETCH` | `on` | `off` turns page reading off |
| `WEB_FETCH_MODEL` | `@cf/qwen/qwen3-30b-a3b-fp8` | The model that condenses long pages; any id the main model accepts works; `off` only truncates |
| `WEB_LEARN` | `on` | Saves lasting facts found by search to Aelios; needs Aelios |
| `STICKERS` | `on` | `off` stops sending and drawing stickers; the packs are kept |
| `VOICE_PROVIDER` | `off` | Who speaks: `elevenlabs`, `cartesia` or `openrouter` |
| `VOICE_ID` | empty | Which voice: required for ElevenLabs and Cartesia; for OpenRouter a voice name, or the model's own voice if empty |
| `VOICE_MODEL` | `eleven_v4` / `sonic-3.6` | The voice model; required for OpenRouter, such as `minimax/speech-2.8-hd` |
| `VOICE_REPLY` | `mirror` | `mirror` answers voice with voice; `always` makes every reply a voice message; `tool` lets it choose |
| `VOICE_API_KEY` | empty | That provider's key; not needed if stored in AI Gateway's Provider Keys |
| `VOICE_BASE_URL` | empty | Usually left empty; when set, voice requests go straight to this address instead of through AI Gateway |
| `CLOUD_TASKS` | `off` | `on` turns on background help: jobs go to threads |
| `CLOUD_TASK_GITHUB_TOKEN` | empty | Optional GitHub token (`repo` and `workflow`): the resident sets up a private repository and runs jobs there on GitHub Actions; can be stored as a Cloudflare secret |
| `CLOUD_TASK_URL` | empty | Optional claude.ai routine trigger URL |
| `CLOUD_TASK_TOKEN` | empty | That trigger's token (when `CLOUD_TASK_URL` is set); can be stored as a Cloudflare secret |
| `CLOUD_TASK_MODEL` | empty | The threads' model, on the resident and on GitHub Actions, as the model picker names it; empty uses Workers AI's `@cf/zai-org/glm-4.7-flash` |
| `AI_GATEWAY_ID` | empty (`default`) | Which AI Gateway search, voice and, without Aelios, the models go through |
| `CUSTOM_BASE_URL` / `CUSTOM_API_KEY` | empty | The relay's address (up to `/v1`) and key; used for `custom/…` models |
| `CUSTOM_FORMAT` | `openai` | The relay's format: `openai` or `anthropic` (with caching) |
| `CLAUDE_CODE_OAUTH_TOKEN` | empty | The setup token from `claude setup-token`, for `claude-code/…` models |
| `CLAUDE_BOX_URL` / `CLAUDE_BOX_KEY` | empty | The [Claude box](docs/claude-box.md)'s address through its Cloudflare Tunnel, and its key (at least 32 characters) |

## What it costs

- **It runs on the Workers free plan.** Going over the free allowance gives errors, not charges. Durable Objects get 100,000 requests a day and Workers AI 10,000 neurons a day, reset at 00:00 UTC. An idle Durable Object sleeps and is not billed for duration. An open web door looks for news every 5 seconds, about 720 requests an hour, and stops when the page is closed or out of sight. A look reads nothing while nothing has changed; the whole conversation is read only when something has, and at least every 2 minutes, so a page left open uses little of the 5 million rows a day Durable Objects may read on the free plan.
- **Workers Paid** ($5/month): usage is billed only beyond the included amount, which this rarely reaches.
- **The default model** `glm-4.7-flash` works on the free plan. 10,000 neurons are roughly 80 to 200 turns a day (an estimate, depending on how long the conversation is). Each check-in counts as a turn.
- **Claude**: with Aelios, it uses the key configured in Aelios. Without Aelios it goes through AI Gateway and uses the Gateway's prepaid credit, or your own Anthropic key if you stored one. Cached input is charged at the cache price (reads are a tenth of the input price or less, a twentieth on Opus 5.5 and Sonnet 5.5); writing a 1-hour cache costs twice the input price, which is what lets a pause, or a letter, still read from the cache. The whole cache is rewritten only after a silence longer than the cache lifetime, on the first message after a letter, and on the first message after a deploy or a change on the settings page (persona, model, tools turned on or off and so on). The usage timeline on the web door shows what each call read from the cache, wrote to it and cost.
- **Search**: your own keys are charged at those services' prices. Without them, Cloudflare's Web Search is used; its default, Ceramic.ai, costs $0.25 per 1000 searches (official price checked on Oct 14).
- **Reading pages**: ordinary fetching is free. Pages that need the browser: Workers Paid includes 10 hours a month, then $0.09 an hour (the free plan gets 10 minutes a day). Condensing a long page with the default Qwen3 30B costs about a tenth of a cent.
- **Voice messages**: hearing uses Whisper at about 46.63 neurons a minute, so the free plan covers a little over 200 minutes a day (official price checked on Oct 22). Speaking is charged at the provider's own price, to your key.
- **Stickers and other MCP servers**: each adds some description to every turn; the settings page shows roughly how many tokens each pack and each server costs.
- **Heartbeats and alarms**: each is one turn of its own. A heartbeat asks while the cache is still warm, so it costs about as much as one of your messages. An alarm that rings after you have been quiet for over an hour finds the cache cold and rewrites the whole conversation (a 1-hour cache write costs twice the input price, a read a tenth or less), which is about as much input as 20-odd ordinary messages. That is why alarms are off by default and capped when on.
- **Cloud Claude Code**: each job is a full cloud session that uses your plan's allowance, like one you open yourself; on the resident's side it is only one more request and one reply.
- **Your Claude subscription** (`claude-code/…`): the chat uses your plan's allowance, not API credit. The box's machine is free on Google Cloud's free tier (one e2-micro in us-west1, us-central1 or us-east1 with a 30 GB standard disk; 1 GB of traffic out a month, about 12 cents a GB after that; with IPv6 only there is no IPv4 address to pay for; official prices checked on Oct 28). Each turn starts Claude Code afresh, so a reply takes a few seconds longer than through the API.

**Note the order in which AI Gateway picks a key**: a key in the request (entered on the settings page) is used first; otherwise the Gateway's key with the alias `default`; with neither, the request goes to Cloudflare's unified billing and is paid from the Gateway's prepaid credit (if the account has credit and that provider is supported). To prevent that, turn on Require provider credentials in the Gateway's settings.

## Troubleshooting

**It does not answer on Telegram**
Look at the Telegram card under **Chat channels** on the settings page: it says whether the bot is connected here and the last error Telegram reported, and **Connect again** (「重新接一次」) points the bot here again. Check that you are listed under **Who can talk to it on Telegram**; it does not answer group chats. With the token in Cloudflare, opening `/tg/setup?secret=…` again does the same; every item should be `"ok":true`.

**It stops answering after a picture**
The model's provider refused the picture (a content check, or a size or format it does not take), and every turn that still carries it would be refused the same way. The resident takes the pictures nobody has answered yet out of the chat, puts 「[图片被退回]」 in their place on the web page, and tells you on Telegram or WeCom with the provider's error, such as `403 permission_error`. Then just carry on. Deleting the picture on Telegram does not help: Telegram does not tell bots about deleted messages.

**WeCom will not save the receiving URL** (「回调地址请求不通过」 or similar)
Save the Token and EncodingAESKey on the resident's settings page first, then click Save in WeCom; the Corp ID must be filled in too. Check that the URL is exactly the one the settings page shows.

**It does not answer on WeCom**
Look at the WeCom card under **Chat channels** on the settings page, or the WeCom line of `/status`; it names what is missing. Common causes:
- **60020**: the relay machine's IP is not among the app's trusted IPs (「企业可信 IP」), or the machine's outgoing IP changed.
- **The relay does not accept the key** (「转发机不认这把钥匙」): the relay key on the settings page differs from the one in `/etc/wecom-relay/env`, for example after `--new-key`.
- **The relay cannot be reached** (「转发机连不上」): check the Tunnel with `curl https://<relay address>/ping -H "x-relay-key: …"`, then `systemctl status wecom-relay` on the machine.
- **Someone was turned away**: the section shows the account it refused; if that is you, add it to who can talk to it.
- **81013**: you are not in the app's visible range (「可见范围」).

**Voice messages fail with 401: no key received** (`Neither authorization header nor xi-api-key received`)
The resident looks for keys only in the Gateway named under **Providers** → **AI Gateway name** (`default` when empty). The key is probably stored in another Gateway, such as the one Aelios uses. Change the name to the Gateway that holds the key, or enter the key under **Voice**. The error and `/status` both name the Gateway it looked in.

**Switching models fails with "Unified billing unavailable"**
Cloudflare's unified billing does not sell this model, or the account has no credit. Store that provider's key in AI Gateway's Provider Keys (alias `default`), or set up a relay under **Providers**.

**Switching models fails with "Unknown gateway provider"**
Cloudflare's model catalog does not know custom providers created in AI Gateway (`custom-xxx/…`). Enter that service's relay address under **Providers** instead, and write the model as `custom/<model name>`.

**No handoff letter for a long time**
Check that both conditions hold: the chat it carries has reached the token threshold, and it has been quiet for the idle time (30000 tokens and 55 minutes by default). Continuous chatting never triggers a letter just by passing the threshold. The conversation line of `/status` shows how much it carries now. To write sooner, lower `LETTER_TOKEN_THRESHOLD` under **Thinking & letters** (whole numbers above 8000); the amount kept after a letter is fixed. `/handoff` skips the threshold, but still writes nothing when there is nothing older to fold. If `/status` says the branch is over 10,000 messages, see [Limits on writing letters](#limits-on-writing-letters).

**A letter failed, or did not reach Aelios**
Under **Thinking & letters**, check the writing status and the Aelios delivery status separately. A failed letter leaves the older chat in place, which is not the same as having nothing to fold; `/handoff` tells you whether it failed, had nothing to fold, or found a letter already being recovered. If the letter was written and only sending failed, click **Retry sync** — no need to write another. For paused letters, first check whether the Aelios settings were removed or the address or memory space changed; restore the original target, then retry. Old letters are never redirected to a new target.

**A cloud job stays at "no reply"**
Most likely the routine's cloud environment does not let the session reach the resident: set network access to Custom and add the resident's domain to the allowed sites. **Open session** on the card shows where it got stuck. If the resident's domain changed (for example, you added your own domain), the prompt on the settings page changes with it and must be pasted into the routine again.

## Development

- How to run the local tests, and what they cover, is in [docs/testing.md](docs/testing.md) (in Chinese). Providers, Telegram, WeCom and Aelios are all fakes, so tests cost nothing and need no Cloudflare login.
- `wrangler.jsonc` deliberately has no `vars`: values in that file would overwrite the dashboard's settings on every push.
- The built-in model catalog is `public/models.json`. It is used when Aelios is not connected or its list cannot be fetched; with Aelios connected, it also adds names and descriptions to the models it knows in Aelios' list. When Cloudflare adds models, run `node scripts/update-models.mjs` and push; if you don't, entering the full id in the search box still works.
- There are two READMEs: `README.md` in English and `README.zh-CN.md` in Chinese. Change both together.

**Not built yet**: group chats on WeCom; phone calls (live voice); true token-by-token streaming (the web door polls while waiting for a reply).

**Third-party code** (in `public/vendor/` and `src/web/`, each keeping its MIT license):

- [Alpine.js](https://github.com/alpinejs/alpine) 3.14.9: the web page (`alpine-LICENSE.txt`)
- [web-fetch](https://github.com/sakisakisa-design/web-fetch): HTML-to-Markdown conversion, address checks and long-page condensing for reading pages (`web-fetch-LICENSE.txt`)

The ordinary web door loads nothing from outside CDNs; only when opened as a Telegram Mini App does it load Telegram's official `telegram-web-app.js`.

## License

AGPL-3.0, the same as [Aelios](https://github.com/wusaki0723/Aelios) (`LICENSE`): use it and change it freely; if you offer a modified version to others as a network service, you must publish your changes under the same license. The third-party files listed above keep their MIT licenses.
