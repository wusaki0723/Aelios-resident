# AGENTS.md

Aelios-resident is an AI companion that runs as one Cloudflare Worker (`aelios-resident`) with one Durable Object, built on Cloudflare's Think. People talk to it on its web door, and optionally on Telegram and WeCom (企业微信; replies to WeCom go through the small relay in `relay/wecom/`, which runs on a machine with a fixed IP behind a Cloudflare Tunnel). With [Aelios](https://github.com/wusaki0723/Aelios) connected it chats through Aelios and remembers.

## If the user wants the resident set up

Follow [docs/setup-with-ai.md](docs/setup-with-ai.md) step by step. It starts from a fresh Cloudflare account (fork and deploy), generates the web door key, connects Telegram if the user wants it, gives the resident an identity in Aelios, picks the model and fills the settings through the web door's API. Users who already have a resident skip the deploy step. If they want long-term memory and have no Aelios yet, set up Aelios first with its own guide.

## Rules that apply to every task in this repo

- Deploy with `npm run deploy` (`npm run deploy:claude` is the same, kept for older Workers Builds settings). For `claude-code/…` models on the user's own Claude subscription, the Claude box in `claude-box/` runs on a machine of the user's: follow [docs/claude-box.md](docs/claude-box.md). Do not rename the Worker in `wrangler.jsonc`, and do not add `vars` there: a value in the file overwrites what the user set in the Dashboard on every deploy. Settings belong on the web door's settings page (or `POST /web/config`).
- Never write secrets into any tracked file, and never ask the user to paste a Telegram bot token, Cloudflare API token, Cloudflare Tunnel token, GitHub token, WeCom app secret, relay key, Claude box key, Claude setup token or model provider key into the chat. The user pastes the bot token on the web door's settings page (聊天渠道 → Telegram), which connects the bot and makes the webhook secret itself, and stores provider keys in Cloudflare themselves. A secret you generate goes straight into a Worker secret through a pipe (`printf %s "$S" | npx wrangler secret put NAME`); never print it or write it to a file. The web door key `WEB_KEY` is the one you hand to the user.
- Never delete or replace the `aelios-resident` Worker, its secrets, a resident, or an Aelios identity without the user's explicit go-ahead. The conversation, persona and stickers live in the Durable Object. More than one resident can live on one Worker (`src/residents.ts`): each is a Durable Object named by its id, the first is `default` and keeps every address it always had, and another one's addresses start with `/r/<id>`.
- The repository is public and other people deploy it. Keep features general and behind a setting; no one's private addresses, names or data in code, docs or tests.

## Working on the code

- Submit changes to this repository on a branch and open a pull request. Do not push directly to `main`, merge a PR, or enable auto-merge unless the user explicitly authorizes that merge.
- For the proposed DSH integration, read [the spec review and Phase 0 gates](docs/dsh-integration-review.md) before implementation; the proposal is not evidence that UI or ACP capabilities already work.

- Node.js 22+. Install with `npm ci`.
- Before a PR: `npm run typecheck`, then the tests in [docs/testing.md](docs/testing.md) for the parts you touched. They run against fake Telegram, a fake WeCom relay, fake Aelios and a scripted model, so they cost nothing and need no Cloudflare login.
- User-facing docs: `README.md` is in English (the default) and `README.zh-CN.md` in Chinese; change both together. `docs/` is in Chinese.
