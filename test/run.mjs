// Drives the local Worker (wrangler dev on :8787, wrangler.test.jsonc) with fake Telegram
// updates and checks what reached the mocked Telegram API and Aelios (mock-server.mjs on :9999).
// Usage: node test/run.mjs [phase]
//   main     (default) everything that needs one fresh Worker
//   checkin  needs a schedule (start wrangler with --var CHECKIN_SCHEDULE:"every 1 minute")
//   idle     threshold AND quiet time, fixed retention (start with --var LETTER_IDLE_MINUTES:0.05)
//   crash-1  sends a slow reply; kill workerd once the first bubble is out, restart, then run crash-2
//   crash-2  checks what she got after the restart
//   migrate  needs the old model variable (start wrangler with --var MODEL:fake)
//   custom   your own provider, without Aelios (start wrangler with --var AELIOS_URL:)
//   mcp      other MCP servers: open, with a key, with a sign-in, and connected from the chat
//   mcp-2    run after mcp and restart.sh: the connections come back
//   stickers sticker packs: imported from a zip and from Telegram, sent, drawn, shown on the web page
//   voice    voice messages: heard, answered in a voice, send_voice, each provider's request, falling back to text
//   tasks    后台帮忙: a job sent through a scheduled task's trigger, its reports, the cards, the limits; threads here,
//            what the web page shows of them, their files, and writing to one directly; the resident finding its
//            threads, their files and the chat again
//   tasks-roles  roles for threads: their templates and models, kept by what follows in the thread
//   tasks-quiet  a task that never reports (start wrangler with --var CLOUD_TASK_QUIET_MINUTES:0.05)
//   sites    keys for sites web_fetch reads, set on the settings page
//   heartbeat  going quiet while the chat is short (start wrangler with --var LETTER_IDLE_MINUTES:0.05
//              --var LETTER_TOKEN_THRESHOLD:100000 --var ALARM_MINUTE_SECONDS:0.05)
//   alarms   alarms the resident sets itself (start wrangler with --var ALARM_MINUTE_SECONDS:0.05)
//   wecom    the WeCom door: its address check, pushes opened and checked, replies, stickers and voice messages
//            through the fake relay, a relay without --media, a wrong relay key, out-of-turn messages
//   web      the web page's own ways to talk: pictures, a quote, a voice message recorded there and replies said back,
//            a sticker, the command buttons, a model change in the chat, its name and avatar, notifications, moving an
//            alarm, answering a thread that needs her, searching the conversation, taking back its latest reply
//   stall    a model that goes quiet: the turn is cut and run again, and the messages after it are answered
//            (start wrangler with --var CHAT_STALL_SECONDS:2)
//   claude-code  claude-code/… models on her own subscription, through the fake Claude box: the token, the trial
//            call, the conversation carried turn to turn, memory recalled and recorded, a tool call and its result,
//            the box key, a letter, pictures, failures
//   telegram the bot token saved on the settings page instead of Cloudflare (start wrangler with
//            --var TG_BOT_TOKEN: --var TG_WEBHOOK_SECRET:): connected, the resident started again, the Mini App
//            and commands with that token, connecting again, a token Telegram refuses, taking it off
//   residents  more than one resident (src/residents.ts): added and listed, its own addresses under /r/<id>, its
//            own settings, conversation, Aelios identity, Telegram bot, avatar and task reports, one push key for
//            all, deleted and added again empty
//   group    group chats (src/group.ts): made of some residents, who answers, @, what each member is handed and
//            keeps in its own chat, rounds, pictures and stickers, the settings and icon, stop, a member on Aelios,
//            a group removed
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { GIF, PNG, WEBM, WEBP, zip } from "./zip.mjs";

const WORKER = "http://127.0.0.1:8787";
const MOCK = "http://127.0.0.1:9999";
const SECRET = "test-secret";
const phase = process.argv[2] ?? "main";

let nextId = { group: 2600, residents: 2500, "claude-code": 2400, main: 100, checkin: 200, idle: 300, "crash-1": 500, "crash-2": 600, migrate: 700, mcp: 800, "mcp-2": 1000, stickers: 1100, voice: 1300, tasks: 1400, "tasks-quiet": 1600, sites: 1700, heartbeat: 1800, alarms: 1900, wecom: 2000, telegram: 2100, web: 2200, stall: 2300 }[phase] ?? 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = async () => (await fetch(`${MOCK}/__log`)).json();
// MarkdownV2 escapes punctuation with a backslash; tests compare the plain text.
const plain = (text) => text.replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, "$1");
const sent = async () =>
  (await log()).filter((e) => e.kind === "tg.sendMessage").map((e) => plain(e.body.text ?? ""));

async function post(text, { username = "her_test", messageId = nextId++, secret = SECRET, chatType = "private", chatId = 42, photo, voice } = {}) {
  // A photo comes in two sizes, its text as the caption.
  const picture = photo && {
    photo: ["s", ""].map((size, i) => ({ file_id: `${photo}${size}`, file_unique_id: `u-${photo}${size}`, width: 90 * (i * 8 + 1), height: 90 * (i * 8 + 1), file_size: 12 + i })),
    caption: text
  };
  const update = {
    update_id: messageId,
    message: {
      message_id: messageId,
      date: Math.floor(Date.now() / 1000),
      ...(picture ?? (voice ? { voice: { file_id: voice, file_unique_id: `u-${voice}`, duration: 3, mime_type: "audio/ogg", file_size: 32 } } : { text })),
      from: { id: chatId, is_bot: false, username, first_name: "Her" },
      chat: { id: chatId, type: chatType, username, first_name: "Her" }
    }
  };
  const response = await fetch(`${WORKER}/messengers/telegram/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(update)
  });
  return { status: response.status, update };
}

async function resend(update) {
  return fetch(`${WORKER}/messengers/telegram/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
    body: JSON.stringify(update)
  });
}

const web = (path, key, body) =>
  fetch(`${WORKER}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "x-web-key": key, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });

/** Wait until the bot has sent `count` more messages than `before`. */
async function waitForSends(before, count, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const all = await sent();
    if (all.length >= before + count) return all.slice(before);
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out: wanted ${count} new sends, have ${all.length - before}: ${JSON.stringify(all.slice(before))}`);
    }
    await sleep(200);
  }
}

let fillerId = 0;
/** Use production-sized chat windows, not a test-only override of the fixed 8000-token retention. */
async function fillChat(count = 3) {
  for (let i = 0; i < count; i += 1) {
    const response = await web("/web/say", "test-web-key", { text: `交接信测试材料 ${++fillerId}：${"文".repeat(3850)}` });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "completed" });
  }
}

async function step(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.log(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

if (phase === "main") {
  await fetch(`${MOCK}/__reset`);

  await step("wrong secret is rejected", async () => {
    const { status } = await post("hi", { secret: "nope" });
    assert.equal(status, 401);
  });

  await step("strangers and group chats get no answer", async () => {
    const before = (await sent()).length;
    assert.equal((await post("hi", { username: "stranger", chatId: 7 })).status, 200);
    assert.equal((await post("hi", { chatType: "group" })).status, 200);
    await sleep(2500);
    assert.equal((await sent()).length, before);
  });

  let first;
  await step("a message gets two bubbles, with the time stamp the model saw", async () => {
    const before = (await sent()).length;
    const { status, update } = await post("你好");
    first = update;
    assert.equal(status, 200);
    const out = await waitForSends(before, 2);
    assert.match(out[0], /^收到：\[\d\d-\d\d 周. \d\d:\d\d\] 你好$/);
    assert.equal(out[1], "这是第二个气泡。");
  });

  await step("typing indicator was sent", async () => {
    const typing = (await log()).filter((e) => e.kind === "tg.sendChatAction");
    assert.ok(typing.length >= 1);
  });

  await step("Telegram resending the same update does not answer twice", async () => {
    const before = (await sent()).length;
    await resend(first);
    await sleep(3000);
    assert.equal((await sent()).length, before);
  });

  await step("the Aelios boot packet is in the system prompt: the diary, without precious notes or the glossary", async () => {
    const before = (await sent()).length;
    await post("开机包");
    const [out] = await waitForSends(before, 1);
    assert.match(out, /^开机包在，第 \d+ 次取的。$/);
    const boot = (await log()).filter((e) => e.kind === "aelios.boot");
    assert.ok(boot.length >= 1);
    assert.equal(boot[0].auth, "Bearer test-key");
    assert.match(boot[0].query, /namespace=test-space/);
  });

  await step("memory_recall reaches Aelios and the answer uses it", async () => {
    const before = (await sent()).length;
    await post("帮我查记忆");
    const out = await waitForSends(before, 1);
    assert.match(out[0], /^我查到了：/);
    assert.ok(out[0].includes("mem-birthday") && out[0].includes("她的生日在春天"), out[0]);
    const recall = (await log()).filter((e) => e.kind === "aelios.recall").at(-1);
    assert.equal(recall.body.namespace, "test-space");
    assert.equal(recall.auth, "Bearer test-key");
  });

  await step("memory_remember saves through Aelios' MCP", async () => {
    const before = (await sent()).length;
    await post("这个记一下");
    const [out] = await waitForSends(before, 1);
    assert.ok(out.includes("mem-new"), out);
    const call = (await log()).filter((e) => e.kind === "aelios.mcp").at(-1);
    assert.equal(call.auth, "Bearer test-key");
    assert.equal(call.body.method, "tools/call");
    assert.equal(call.body.params.name, "remember");
    assert.deepEqual(call.body.params.arguments, { content: "她喜欢春天", namespace: "test-space" });
  });

  await step("the notebook is read and written through Aelios' MCP, and a long page comes back whole", async () => {
    let before = (await sent()).length;
    await post("看小本本");
    let out = (await waitForSends(before, 1)).join("\n");
    assert.ok(out.includes("下一步：第 29 章"), `the end of a long page: ${out.slice(-80)}`);
    let call = (await log()).filter((e) => e.kind === "aelios.mcp").at(-1);
    assert.equal(call.body.params.name, "notebook");
    assert.deepEqual(call.body.params.arguments, { action: "read", name: "经济师进度", namespace: "test-space" });
    before = (await sent()).length;
    await post("记进小本本");
    await waitForSends(before, 1);
    call = (await log()).filter((e) => e.kind === "aelios.mcp").at(-1);
    assert.deepEqual(call.body.params.arguments, { action: "append", name: "经济师进度", content: "第 29 章学完", namespace: "test-space" });
  });

  // Reading real pages (redirects, the browser, compression, the cache) is covered by test/web.mjs.
  await step("web_fetch refuses local addresses", async () => {
    const before = (await sent()).length;
    await post("帮我读本机");
    const [refused] = await waitForSends(before, 1);
    assert.match(refused, /^我查到了：Cannot read this URL/);
  });

  await step("three quick messages are answered once, together", async () => {
    const before = (await sent()).length;
    await post("一");
    await post("二");
    await post("三");
    const out = await waitForSends(before, 2);
    await sleep(3000);
    const all = (await sent()).slice(before);
    assert.equal(all.length, 2, JSON.stringify(all));
    assert.match(out[0], /^收到：\[[^\]]+\] 一\n二\n三$/);
  });

  await step("/status answers without a model turn", async () => {
    const before = (await sent()).length;
    await post("/status");
    const [out] = await waitForSends(before, 1);
    assert.match(out, /^模型：fake\n/);
    assert.match(out, /\n对话：\d+ 条/);
    assert.match(out, /交接信：0 封/);
    assert.match(out, /人设：还没填/);
    assert.match(out, /\n上一次调用模型：输入 \d+ token，其中缓存读 \d+/);
    assert.match(out, /主动找你：关/);
  });

  await step("/letter before any letter", async () => {
    const before = (await sent()).length;
    await post("/letter");
    assert.deepEqual(await waitForSends(before, 1), ["还没写过交接信。"]);
  });

  await step("/handoff writes a letter below the automatic threshold, and the conversation carries it", async () => {
    await fillChat();
    let before = (await sent()).length;
    await post("/handoff");
    const [out] = await waitForSends(before, 1, 30000);
    assert.match(out, /^交接信写好了，旧的聊天收起来了：\n\n亲爱的下一个我/);
    assert.ok(out.includes("（前文和上一轮一字不差）"), `the letter turn must repeat the chat's request, to be read from cache: ${out}`);
    assert.ok(out.includes("（缓存标记在上一轮那句）"), `the letter turn reads the cache and writes none: the marker stays where the turn before put it: ${out}`);
    before = (await sent()).length;
    await post("交接信在吗");
    assert.deepEqual(await waitForSends(before, 1), ["交接信在。"]);
    const letterIngest = (await log()).filter((e) => e.kind === "aelios.ingest" && e.body.source === "aelios-resident:letter");
    assert.equal(letterIngest.length, 1);
    assert.match(letterIngest[0].body.messages[0].content, /^（交接信）亲爱的下一个我/);
  });

  await step("/letter shows the latest letter", async () => {
    const before = (await sent()).length;
    await post("/letter");
    const [out] = await waitForSends(before, 1);
    assert.match(out, /写的：\n\n亲爱的下一个我/);
  });

  await step("the web door is shut without WEB_KEY", async () => {
    assert.equal((await fetch(`${WORKER}/web/messages`)).status, 401);
    assert.equal((await web("/web/messages", "wrong")).status, 401);
    assert.equal((await web("/web/check", "test-web-key")).status, 200);
  });

  await step("the web door sees the Telegram conversation, letter included", async () => {
    const response = await web("/web/messages", "test-web-key");
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.ok(data.some((l) => l.kind === "letter" && l.text.includes("亲爱的下一个我")), JSON.stringify(data));
    const asked = data.find((l) => l.role === "user" && l.text === "交接信在吗");
    assert.ok(asked, JSON.stringify(data));
    assert.equal(asked.via, "telegram");
    assert.equal(typeof asked.at, "number");
    assert.ok(data.some((l) => l.role === "assistant" && l.text === "交接信在。" && l.via === "telegram"));
  });

  await step("the search finds what she said before the letter, folded out of the chat", async () => {
    const { data } = await (await web("/web/messages", "test-web-key")).json();
    assert.ok(!data.some((l) => l.role === "user" && l.text === "帮我查记忆"), "folded into the letter");
    const response = await web(`/web/search?q=${encodeURIComponent("帮我查记忆")}`, "test-web-key");
    assert.equal(response.status, 200);
    const { results } = await response.json();
    const hit = results.find((h) => h.role === "user");
    assert.ok(hit, JSON.stringify(results));
    assert.equal(hit.before + hit.match + hit.after, "帮我查记忆", "her words, without the time stamp");
    const around = await (await web(`/web/search/around?id=${encodeURIComponent(hit.id)}`, "test-web-key")).json();
    assert.equal(around.lines.find((line) => line.hit)?.id, hit.id, JSON.stringify(around));
    assert.ok(!around.lines.some((line) => /亲爱的下一个我/.test(line.text)), "the letter is not one of the messages");
  });

  await step("the boot packet is fetched again only in a new cache window: after a letter, not while the cache is warm", async () => {
    const fetched = async () => (await log()).filter((e) => e.kind === "aelios.boot").length;
    const carried = async () => {
      const before = (await sent()).length;
      await post("开机包");
      const [out] = await waitForSends(before, 1);
      return Number(out.match(/第 (\d+) 次取/)?.[1]);
    };
    const first = await carried();
    const count = await fetched();
    assert.equal(await carried(), first, "a warm cache keeps the packet it has");
    assert.equal(await fetched(), count, "and Aelios is not asked again");
    await fillChat();
    const before = (await sent()).length;
    await post("/handoff");
    const [letter] = await waitForSends(before, 1, 30000);
    assert.match(letter, /^交接信写好了/);
    const fresh = await carried();
    assert.ok(fresh > first, `the letter folded the chat, so the next turn takes a fresh packet: ${first} then ${fresh}`);
    assert.equal(await carried(), fresh);
  });

  await step("a message typed on the web is answered there, not on Telegram", async () => {
    const before = (await sent()).length;
    const response = await web("/web/say", "test-web-key", { text: "网页上说一句" });
    assert.deepEqual(await response.json(), { status: "completed" });
    const { data } = await (await web("/web/messages", "test-web-key")).json();
    const said = data.findLast((l) => l.role === "user");
    assert.equal(said.text, "网页上说一句");
    assert.equal(said.via, "web");
    assert.equal(typeof said.at, "number");
    const reply = data.at(-1);
    assert.equal(typeof reply.at, "number");
    assert.match(reply.text, /^收到：\[[^\]]+\] 网页上说一句/);
    await sleep(1500);
    assert.equal((await sent()).length, before);
  });

  await step("a photo she sends reaches the model as a picture, and the web page shows it", async () => {
    const before = (await sent()).length;
    await post("看图", { photo: "photo-1" });
    assert.deepEqual(await waitForSends(before, 1), ["看到 1 张图。"]);
    assert.ok((await log()).some((e) => e.kind === "tg.file" && e.path === "photos/photo-1.jpg"), "the largest size was downloaded");
    const { data } = await (await web("/web/messages", "test-web-key")).json();
    const line = data.findLast((l) => l.role === "user");
    assert.deepEqual([line.text, line.pictures], ["看图", 1], "the words, and one picture to show");
    const picture = await web(`/web/picture?id=${encodeURIComponent(line.id)}&n=0`, "test-web-key");
    assert.equal(picture.status, 200);
    assert.match(picture.headers.get("content-type"), /^image\//);
    assert.equal(picture.headers.get("content-security-policy"), "sandbox", "never a page of this origin");
    assert.equal(picture.headers.get("x-content-type-options"), "nosniff");
    assert.ok((await picture.arrayBuffer()).byteLength > 0);
    assert.equal((await web(`/web/picture?id=${encodeURIComponent(line.id)}&n=1`, "test-web-key")).status, 404, "only the pictures it has");
    assert.equal((await web(`/web/picture?id=${encodeURIComponent(line.id)}&n=0`, "wrong-key")).status, 401, "only with the web key");
  });

  await step("a photo that cannot be downloaded stays a line of text", async () => {
    const before = (await sent()).length;
    await post("看图", { photo: "gone" });
    assert.deepEqual(await waitForSends(before, 1), ["看到 0 张图，还有一行附件说明。"]);
  });

  await step("a picture the provider refuses is taken out of the chat and she is told, so the next turn works", async () => {
    const before = (await sent()).length;
    // The fake model answers 403 permission_error for as long as a picture sent with 拒收 is in the chat.
    await post("拒收这张", { photo: "photo-2" });
    const [notice] = await waitForSends(before, 1);
    assert.match(notice, /退回了（403 permission_error）/);
    const { data } = await (await web("/web/messages", "test-web-key")).json();
    assert.equal(data.findLast((l) => l.role === "user").text, "拒收这张\n[图片被退回]");
    const after = (await sent()).length;
    await post("看图");
    assert.deepEqual(await waitForSends(after, 1), ["看到 0 张图。"], "the refused picture no longer goes with every turn");
  });

  await step("the heart keeps a line in Aelios' precious memories", async () => {
    const response = await web("/web/pin", "test-web-key", { text: "这是第二个气泡。" });
    assert.deepEqual(await response.json(), { ok: true });
    const precious = (await log()).filter((e) => e.kind === "aelios.precious").at(-1);
    assert.equal(precious.body.content, "这是第二个气泡。");
    assert.equal(precious.body.namespace, "test-space");
  });

  await step("every turn asks for prompt caching (Claude's Messages API reads it)", async () => {
    const before = (await sent()).length;
    await post("缓存在吗");
    assert.deepEqual(await waitForSends(before, 1), ["缓存标记在，1h。"]);
  });

  await step("the model is picked on the web, after one trial call, and remembered as recent", async () => {
    let model = await (await web("/web/model", "test-web-key")).json();
    assert.equal(model.model, "");
    assert.equal(model.fallback, "fake");
    assert.deepEqual(model.recent, []);
    assert.equal(typeof model.lastUsage.input, "number");
    assert.equal((await web("/web/model", "wrong", { text: "fake" })).status, 401);
    // Aelios turns down a name without its provider, so the trial call fails and nothing is saved.
    let response = await web("/web/model", "test-web-key", { text: "gpt" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /^这个模型用不了：.*provider prefix/);
    model = await (await web("/web/model", "test-web-key")).json();
    assert.equal(model.model, "");
    response = await web("/web/model", "test-web-key", { text: " fake " });
    assert.equal(response.status, 200);
    model = await response.json();
    assert.equal(model.model, "fake");
    assert.equal(typeof model.at, "number");
    // Only models that passed their trial call are offered again in the picker.
    assert.deepEqual(model.recent, ["fake"]);
    const before = (await sent()).length;
    await post("/status");
    const [out] = await waitForSends(before, 1);
    assert.match(out, /^模型：fake\n/);
  });

  await step("the picker's list is Aelios' own model list; Aelios refusing is reported, not thrown", async () => {
    await fetch(`${MOCK}/__reset`);
    assert.equal((await web("/web/models", "wrong")).status, 401);
    let list = await (await web("/web/models", "test-web-key")).json();
    assert.deepEqual([list.aelios, list.curated, list.error], [true, true, undefined]);
    assert.deepEqual(list.models, [
      { id: "chatgpt/gpt-5", owner: "chatgpt", main: true },
      { id: "openrouter/openai/gpt-6.1-sol:floor", owner: "openrouter", main: false },
      { id: "anthropic/claude-opus-5-5", owner: "anthropic", main: true }
    ]);
    const asked = (await log()).filter((e) => e.kind === "aelios.models");
    assert.equal(asked.length, 1);
    assert.equal(asked[0].auth, "Bearer test-key");
    await fetch(`${MOCK}/__faults`, { method: "POST", body: JSON.stringify({ models: "refuse" }), headers: { "content-type": "application/json" } });
    list = await (await web("/web/models", "test-web-key")).json();
    assert.deepEqual([list.aelios, list.models.length, list.curated, list.error], [true, 0, false, "Aelios answered 401"]);
    await fetch(`${MOCK}/__reset`);
  });

  await step("with Aelios connected, the chat goes out through Aelios, which recalls and records it", async () => {
    await fillChat();
    await fetch(`${MOCK}/__reset`);
    let response = await web("/web/model", "test-web-key", { text: "anthropic/claude-test" });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    let calls = (await log()).filter((e) => e.kind === "aelios.messages");
    assert.equal(calls.length, 1, "the trial call");
    assert.equal(calls[0].purpose, "auxiliary", "the trial call is not something she said");
    assert.equal(calls[0].apiKey, "test-key");
    assert.equal(calls[0].identity, null);
    let before = (await sent()).length;
    await post("从 Aelios 过吗");
    const [first] = await waitForSends(before, 1);
    assert.match(first, /^Aelios 收到 \d+ 条，缓存标记有，旧思考块 0 个$/);
    calls = (await log()).filter((e) => e.kind === "aelios.messages");
    const turn = calls.at(-1);
    assert.equal(turn.purpose, null, "her turn is hers");
    assert.equal(turn.body.model, "anthropic/claude-test");
    assert.equal(turn.body.stream, true);
    assert.ok(turn.body.cache_control, "the cache marker rides along, for Aelios to put on her message");
    assert.match(JSON.stringify(turn.body.messages.at(-1)), /从 Aelios 过吗/);
    // The resident no longer searches or records her turns itself: Aelios does both.
    const own = (await log()).filter((e) => e.kind === "aelios.recall" || (e.kind === "aelios.ingest" && e.body.source === "aelios-resident"));
    assert.deepEqual(own, []);
    before = (await sent()).length;
    await post("再来一句");
    const [second] = await waitForSends(before, 1);
    assert.match(second, /^Aelios 收到 \d+ 条，缓存标记有，旧思考块 0 个$/, "earlier thinking stays home");
  });

  await step("the letter written through Aelios is marked as not hers", async () => {
    const before = (await sent()).length;
    await post("/handoff");
    const [out] = await waitForSends(before, 1, 30000);
    assert.match(out, /^交接信写好了/);
    const letter = (await log()).filter((e) => e.kind === "aelios.messages").at(-1);
    assert.equal(letter.purpose, "auxiliary");
    assert.match(JSON.stringify(letter.body.messages.at(-1)), /time to write a handoff letter/);
    // Nothing reads what the letter's turn would write, so the marker is on her last message, as on her turn.
    assert.equal(letter.body.cache_control, undefined, "no marker at the end");
    const marked = letter.body.messages.flatMap((m, i) => (Array.isArray(m.content) ? m.content : []).map((b, j) => (b.cache_control ? [i, j, b] : null)).filter(Boolean));
    const her = letter.body.messages.length - 3;
    assert.equal(marked.length, 1, JSON.stringify(marked));
    assert.equal(marked[0][0], her);
    assert.equal(marked[0][1], letter.body.messages[her].content.length - 1, "on its last block");
    assert.match(JSON.stringify(letter.body.messages[her]), /再来一句/);
    assert.deepEqual(marked[0][2].cache_control, { type: "ephemeral", ttl: "1h" });
  });

  await step("a model Aelios keeps no memory for is not picked; a Workers AI id goes under workers-ai/", async () => {
    let response = await web("/web/model", "test-web-key", { text: "anthropic/plain-model" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /不是这个身份的主模型/);
    response = await web("/web/model", "test-web-key", { text: "@cf/test/glm" });
    assert.equal(response.status, 200);
    const before = (await sent()).length;
    await post("换成聊天格式");
    const [out] = await waitForSends(before, 1);
    assert.match(out, /^Aelios（workers-ai\/@cf\/test\/glm）收到：\[[^\]]+\] 换成聊天格式$/);
    const turn = (await log()).filter((e) => e.kind === "aelios.chat").at(-1);
    assert.equal(turn.auth, "Bearer test-key");
    assert.equal(turn.purpose, null);
    assert.equal((await (await web("/web/model", "test-web-key")).json()).memoryOff, false);
  });

  await step("when Aelios keeps no memory for her turns any more, the page and /status say so", async () => {
    let response = await web("/web/model", "test-web-key", { text: "anthropic/claude-dropped" });
    assert.equal(response.status, 200);
    let before = (await sent()).length;
    await post("还记得住吗");
    await waitForSends(before, 1);
    assert.equal((await (await web("/web/model", "test-web-key")).json()).memoryOff, true);
    before = (await sent()).length;
    await post("/status");
    const [out] = await waitForSends(before, 1);
    assert.match(out, /长期记忆 Aelios：接着，但这个模型不在 Aelios 那个身份的主模型里/);
    response = await web("/web/model", "test-web-key", { text: "@cf/test/glm" });
    assert.equal((await response.json()).memoryOff, false, "only for the model it was said about");
  });

  await step("Claude's thinking is asked to be shown, and THINKING_EFFORT set on the settings page applies", async () => {
    const lastMessages = async () => (await log()).filter((e) => e.kind === "aelios.messages").at(-1);
    let response = await web("/web/model", "test-web-key", { text: "anthropic/claude-opus-5.5" });
    assert.equal(response.status, 200);
    let call = await lastMessages();
    assert.equal(call.purpose, "auxiliary");
    assert.deepEqual(call.body.thinking, { type: "adaptive", display: "summarized" }, "the trial call is shaped like the chat");
    assert.equal(call.body.output_config, undefined, "auto sends no effort");
    response = await web("/web/config", "test-web-key", { key: "THINKING_EFFORT", text: "huge" });
    assert.equal(response.status, 400);
    await web("/web/config", "test-web-key", { key: "THINKING_EFFORT", text: "high" });
    let before = (await sent()).length;
    await post("想深一点");
    await waitForSends(before, 1);
    call = await lastMessages();
    assert.equal(call.purpose, null);
    assert.equal(call.body.model, "anthropic/claude-opus-5-5");
    assert.deepEqual(call.body.thinking, { type: "adaptive", display: "summarized" });
    assert.deepEqual(call.body.output_config, { effort: "high" });
    await web("/web/config", "test-web-key", { key: "THINKING_EFFORT", text: "" });
    before = (await sent()).length;
    await post("回到默认");
    await waitForSends(before, 1);
    assert.equal((await lastMessages()).body.output_config, undefined);
    response = await web("/web/model", "test-web-key", { text: "@cf/test/glm" });
    assert.equal(response.status, 200);
  });

  await step("the usage timeline has a row for every call, with the cache split and a list price, and no chat", async () => {
    assert.equal((await web("/web/usage", "wrong")).status, 401);
    const usage = await (await web("/web/usage", "test-web-key")).json();
    assert.equal(usage.keepDays, 90);
    const { today, week, month } = usage.totals;
    assert.ok(today.calls > 0 && today.calls === week.calls && week.calls === month.calls, JSON.stringify(usage.totals));
    if (!usage.more) assert.equal(today.calls, usage.rows.length);
    assert.ok(usage.rows.every((row, i) => i === 0 || row.id < usage.rows[i - 1].id), "newest first");
    const test = usage.rows.filter((row) => row.model === "anthropic/claude-test");
    assert.deepEqual([...new Set(test.map((row) => row.kind))].sort(), ["chat", "letter", "trial"]);
    const chats = test.filter((row) => row.kind === "chat");
    assert.equal(chats.length, 2);
    for (const row of chats) {
      assert.equal(row.via, "telegram");
      assert.deepEqual([row.input, row.cacheRead, row.cacheWrite, row.cacheWrite1h, row.output], [20, 1000, 300, 300, 5]);
      assert.equal(row.cost, null, "a model with no list price");
    }
    const opus = usage.rows.filter((row) => row.model === "anthropic/claude-opus-5-5" && row.kind === "chat");
    assert.equal(opus.length, 2);
    // 20 × $4 + 1000 × $0.20 + 300 × $8 (one-hour write) + 5 × $20, per million tokens.
    for (const row of opus) assert.ok(Math.abs(row.cost - 0.00278) < 1e-9, String(row.cost));
    assert.ok(today.unpriced > 0 && today.cost >= 0.00556 - 1e-9, JSON.stringify(today));
    assert.ok(usage.rows.some((row) => row.model === "fake" && row.tools.includes("memory_recall")), "tool names are kept");
    const text = JSON.stringify(usage);
    for (const said of ["从 Aelios 过吗", "再来一句", "想深一点"]) assert.ok(!text.includes(said), `no chat in the timeline: ${said}`);
    const older = await (await web(`/web/usage?before=${usage.rows[1].id}`, "test-web-key")).json();
    assert.equal(older.totals, null, "the totals come with the first page only");
    assert.ok(older.rows.length > 0 && older.rows.every((row) => row.id < usage.rows[1].id));
  });

  await step("the settings page: secrets stay unread, bad values are refused, a saved value applies to the next message", async () => {
    assert.equal((await web("/web/config", "wrong")).status, 401);
    let config = await (await web("/web/config", "test-web-key")).json();
    const field = (key) => config.fields.find((f) => f.key === key);
    assert.deepEqual(field("AELIOS_API_KEY"), { key: "AELIOS_API_KEY", kind: "secret", value: "", fromWorker: "", saved: false, workerHas: true });
    assert.ok(!JSON.stringify(config).includes("test-key"), "no secret reaches the page");
    assert.equal(field("TIME_ZONE").fromWorker, "Asia/Shanghai");
    assert.equal(field("KEEP_RECENT_TOKENS"), undefined, "the old retention setting is no longer editable");
    config = await (await web("/web/config", "test-web-key", { key: "LETTER_TOKEN_THRESHOLD", text: "50000" })).json();
    assert.equal(field("LETTER_TOKEN_THRESHOLD").value, "50000");
    config = await (await web("/web/config", "test-web-key", { key: "LETTER_TOKEN_THRESHOLD", text: "" })).json();
    assert.equal(field("LETTER_TOKEN_THRESHOLD").value, "");
    assert.ok(!config.fields.some((f) => ["TG_WEBHOOK_SECRET", "WEB_KEY"].includes(f.key)), "the webhook secret and the web key are never on the page");
    assert.deepEqual(field("TG_BOT_TOKEN"), { key: "TG_BOT_TOKEN", kind: "secret", value: "", fromWorker: "", saved: false, workerHas: true });
    assert.ok(!JSON.stringify(config).includes("test-token") && !JSON.stringify(config).includes(SECRET));
    for (const [key, text, problem] of [
      ["TIME_ZONE", "Mars/Olympus", /时区/],
      ["LETTER_TOKEN_THRESHOLD", "abc", /大于 8000 的整数/],
      ["LETTER_TOKEN_THRESHOLD", "Infinity", /大于 8000 的整数/],
      ["LETTER_TOKEN_THRESHOLD", "1e309", /大于 8000 的整数/],
      ["LETTER_TOKEN_THRESHOLD", "8000", /大于 8000 的整数/],
      ["LETTER_TOKEN_THRESHOLD", "9000.5", /大于 8000 的整数/],
      ["KEEP_RECENT_TOKENS", "10", /没有这个设置/],
      ["LETTER_IDLE_MINUTES", "Infinity", /分钟数/],
      ["CACHE_TTL", "2h", /只能填/],
      ["AELIOS_URL", "ftp://x", /https/],
      ["NOT_A_SETTING", "x", /没有这个设置/],
      ["CHECKIN_SCHEDULE", "whenever you like", /排不上/]
    ]) {
      const response = await web("/web/config", "test-web-key", { key, text });
      assert.equal(response.status, 400, key);
      assert.match((await response.json()).error, problem, key);
    }
    config = await (await web("/web/config", "test-web-key")).json();
    assert.equal(field("CHECKIN_SCHEDULE").value, "", "a schedule that cannot be armed is not kept");
    // The identity in Aelios: the next message goes out as it.
    config = await (await web("/web/config", "test-web-key", { key: "AELIOS_IDENTITY", text: " resident " })).json();
    assert.equal(field("AELIOS_IDENTITY").value, "resident");
    let before = (await sent()).length;
    await post("换身份");
    await waitForSends(before, 1);
    assert.equal((await log()).filter((e) => e.kind === "aelios.chat").at(-1).identity, "resident");
    // Who may talk on Telegram: someone else, then back to the Worker's own list.
    config = await (await web("/web/config", "test-web-key", { key: "TG_ALLOWED", text: "@someone_else" })).json();
    before = (await sent()).length;
    await post("现在不认我了");
    await sleep(2500);
    assert.equal((await sent()).length, before, "her chat is not in the list any more");
    config = await (await web("/web/config", "test-web-key", { key: "TG_ALLOWED", text: "" })).json();
    assert.equal(field("TG_ALLOWED").value, "");
    before = (await sent()).length;
    await post("又认我了");
    await waitForSends(before, 1);
    // A secret saved here wins over the Worker's, and is still never shown.
    config = await (await web("/web/config", "test-web-key", { key: "AELIOS_API_KEY", text: "panel-key" })).json();
    assert.equal(field("AELIOS_API_KEY").saved, true);
    assert.ok(!JSON.stringify(config).includes("panel-key"));
    before = (await sent()).length;
    await post("换钥匙");
    await waitForSends(before, 1);
    assert.equal((await log()).filter((e) => e.kind === "aelios.chat").at(-1).auth, "Bearer panel-key");
    for (const key of ["AELIOS_API_KEY", "AELIOS_IDENTITY"]) await web("/web/config", "test-web-key", { key, text: "" });
    const response = await web("/web/model", "test-web-key", { text: "fake" });
    assert.equal(response.status, 200);
  });

  let fallback;
  await step("with no persona written yet, the default line is the persona", async () => {
    const persona = await (await web("/web/persona", "test-web-key")).json();
    assert.equal(persona.text, "");
    assert.equal(persona.at, null);
    assert.deepEqual(persona.versions, []);
    fallback = persona.fallback;
    assert.ok(fallback);
    const before = (await sent()).length;
    await post("你是谁");
    assert.deepEqual(await waitForSends(before, 1), [fallback]);
  });

  await step("a persona saved on the web applies from the next message", async () => {
    assert.equal((await web("/web/persona", "wrong", { text: "x" })).status, 401);
    assert.equal((await web("/web/persona", "test-web-key", { text: "长".repeat(30001) })).status, 400);
    const response = await web("/web/persona", "test-web-key", { text: "  你是测试用的住户，说话很温柔。\n第二行。  " });
    const saved = await response.json();
    assert.equal(response.status, 200);
    assert.equal(saved.text, "你是测试用的住户，说话很温柔。\n第二行。");
    assert.equal(typeof saved.at, "number");
    const before = (await sent()).length;
    await post("你是谁");
    assert.deepEqual(await waitForSends(before, 1), ["你是测试用的住户，说话很温柔。"]);
    const [status] = await (async () => {
      const mark = (await sent()).length;
      await post("/status");
      return waitForSends(mark, 1);
    })();
    assert.match(status, /人设：网页上填的，20 字/);
  });

  await step("earlier personas can be brought back, and saving empty goes back to the default", async () => {
    await web("/web/persona", "test-web-key", { text: "第二版人设。" });
    const persona = await (await web("/web/persona", "test-web-key", { text: "" })).json();
    assert.equal(persona.text, "");
    assert.deepEqual(persona.versions.map((v) => v.text), ["第二版人设。", "你是测试用的住户，说话很温柔。\n第二行。"]);
    const before = (await sent()).length;
    await post("你是谁");
    assert.deepEqual(await waitForSends(before, 1), [fallback]);
  });

  await step("with PERSONA_EDIT on it changes its own persona, which the web page shows with the one before", async () => {
    const say = async (text) => {
      const before = (await sent()).length;
      await post(text);
      return (await waitForSends(before, 1)).join("\n");
    };
    const persona = async () => (await web("/web/persona", "test-web-key")).json();
    let config = await (await web("/web/config", "test-web-key")).json();
    assert.equal(config.fields.find((f) => f.key === "PERSONA_EDIT").value, "", "off unless turned on");
    assert.match(await say("改人设工具在吗"), /没有 edit_persona/);
    config = await (await web("/web/config", "test-web-key", { key: "PERSONA_EDIT", text: "on" })).json();
    assert.equal(config.fields.find((f) => f.key === "PERSONA_EDIT").value, "on");
    assert.match(await say("改人设工具在吗"), /有 edit_persona/);
    // Added at the end of the default line, then a piece of it replaced: each one an earlier version.
    assert.match(await say("人设加一句：你叫麻薯。"), /"saved":true/);
    assert.equal((await persona()).text, `${fallback}\n\n你叫麻薯。`);
    assert.match(await say("人设改成：你叫麻薯。=>你叫团子。"), /"saved":true/);
    const changed = await persona();
    assert.equal(changed.text, `${fallback}\n\n你叫团子。`);
    assert.equal(changed.versions[0].text, `${fallback}\n\n你叫麻薯。`);
    assert.equal(changed.fallback, fallback);
    // What it cannot do: change a piece that is not there, write what some keys refuse, or leave nothing.
    assert.match(await say("人设改成：没有这句=>随便"), /Not changed: old_text is not in your persona/);
    assert.match(await say("人设加一句：我住在 Claude Code 里。"), /Not changed: Some Claude API keys/);
    assert.match(await say(`人设改成：${fallback}\n\n你叫团子。=>`), /Not changed: That would leave your persona empty/);
    assert.equal((await persona()).text, `${fallback}\n\n你叫团子。`, "nothing refused was saved");
    const notices = (await (await web("/web/messages", "test-web-key")).json()).data.filter((line) => line.kind === "notice" && line.text === "它自己改了人设");
    assert.equal(notices.length, 2, "a line in the chat for each change");
    // Off again: the tool is gone, the persona it wrote stays.
    await web("/web/config", "test-web-key", { key: "PERSONA_EDIT", text: "" });
    assert.match(await say("改人设工具在吗"), /没有 edit_persona/);
    await web("/web/persona", "test-web-key", { text: "" });
  });
}

if (phase === "checkin") {
  await fetch(`${MOCK}/__reset`);
  await step("a message first, so the resident knows her chat", async () => {
    await post("你好");
    await waitForSends(0, 2);
  });
  await step("the check-in schedule starts a conversation on its own", async () => {
    const before = (await sent()).length;
    const out = await waitForSends(before, 2, 75000);
    assert.deepEqual(out, ["主动来找你啦。", "记得喝水。"]);
    // Recording in Aelios runs after the bubbles are out.
    let ingest = [];
    for (let i = 0; i < 50 && !ingest.length; i += 1) {
      await sleep(100);
      ingest = (await log()).filter((e) => e.kind === "aelios.ingest" && e.body.source === "aelios-resident:checkin");
    }
    assert.equal(ingest.length, 1);
    assert.deepEqual(ingest[0].body.messages.map((m) => m.role), ["assistant"]);
  });
  await step("a check-in that answers SKIP sends nothing", async () => {
    const before = (await sent()).length;
    await sleep(70000);
    assert.deepEqual((await sent()).slice(before), []);
    const runs = (await log()).filter((e) => e.kind === "aelios.ingest" && e.body.source === "aelios-resident:checkin");
    assert.equal(runs.length, 1);
  });
}

if (phase === "idle") {
  await fetch(`${MOCK}/__reset`);
  const KEY = "test-web-key";
  const letters = async () => (await log()).filter((e) => e.kind === "aelios.ingest" && e.body.source === "aelios-resident:letter");
  await web("/web/config", KEY, { key: "HEARTBEAT", text: "0" });

  await step("quiet time alone does not write a letter, even with more than 8000 tokens of chat", async () => {
    await fillChat(); // ~11600 tokens: foldable, but below the 30000 automatic threshold.
    await sleep(6000);
    assert.equal((await letters()).length, 0);
    const { data } = await (await web("/web/messages", KEY)).json();
    assert.ok(!data.some((line) => line.kind === "letter"));
  });

  await step("50000 and 30000 are trigger settings, not retention budgets", async () => {
    const response = await web("/web/config", KEY, { key: "LETTER_TOKEN_THRESHOLD", text: "50000" });
    assert.equal(response.status, 200);
    await fillChat(6); // ~35000 total: above 30000 but below the selected 50000.
    await sleep(6000);
    assert.equal((await letters()).length, 0);
    const changed = await web("/web/config", KEY, { key: "LETTER_TOKEN_THRESHOLD", text: "30000" });
    assert.equal(changed.status, 200);
    assert.equal((await web("/web/config", KEY, { key: "HEARTBEAT", text: "3" })).status, 200);
  });

  await step("crossing the threshold while chatting does not write immediately; a new message resets the quiet timer", async () => {
    await fillChat(1);
    await sleep(500);
    assert.equal((await letters()).length, 0, "a threshold is not an immediate trigger");
    await fillChat(1);
    await sleep(1000);
    assert.equal((await letters()).length, 0, "still within the new message's quiet time");
  });

  await step("threshold AND quiet time writes silently, keeps about 8000 original tokens and carries the letter", async () => {
    const before = (await sent()).length;
    const start = Date.now();
    let ingest = [];
    while (!ingest.length) {
      if (Date.now() - start > 20000) throw new Error("no letter after threshold and quiet time");
      await sleep(200);
      ingest = await letters();
    }
    assert.match(ingest[0].body.messages[0].content, /^（交接信）亲爱的下一个我.*（前文和上一轮一字不差）（缓存标记在上一轮那句）/);
    assert.deepEqual((await sent()).slice(before), [], "the idle letter sends her nothing, even with heartbeat enabled");
    const { data: lines } = await (await web("/web/messages", KEY)).json();
    assert.equal(lines.filter((line) => line.kind === "letter").length, 1);
    const original = lines.filter((line) => line.kind === "chat");
    const chars = original.reduce((sum, line) => sum + line.text.length, 0);
    assert.ok(chars > 7000 && chars < 8100, `fixed recent chat, not the 30000 trigger: ${chars} chars`);
    assert.ok(!original.some((line) => line.text.startsWith("交接信测试材料 1：")), "the first messages are folded too");
    assert.ok(!lines.some((line) => line.text.includes("time to write a handoff letter")), "the letter prompt is gone again");
    assert.equal((await web("/web/config", KEY, { key: "HEARTBEAT", text: "0" })).status, 200);
    const mark = (await sent()).length;
    await post("交接信在吗");
    assert.deepEqual(await waitForSends(mark, 1), ["交接信在。"]);
  });

  await step("after a letter, a short new exchange does not cause another letter at the next quiet time", async () => {
    await sleep(8000);
    assert.equal((await letters()).length, 1);
  });
}

if (phase === "migrate") {
  await fetch(`${MOCK}/__reset`);
  await step("the old MODEL variable is carried onto the web setting once", async () => {
    const model = await (await fetch(`${WORKER}/web/model`, { headers: { "x-web-key": "test-web-key" } })).json();
    assert.equal(model.model, "fake");
    assert.equal(typeof model.at, "number");
    await post("你好");
    await waitForSends(0, 2);
  });
}

if (phase === "custom") {
  await fetch(`${MOCK}/__reset`);
  await step("a provider of your own (custom/…, OpenAI format) is tried, picked and answers with your key", async () => {
    let response = await web("/web/model", "test-web-key", { text: "custom/nous/claude-test" });
    const picked = await response.json();
    assert.equal(response.status, 200, JSON.stringify(picked));
    assert.equal(picked.model, "custom/nous/claude-test");
    const before = (await sent()).length;
    await post("自己的供应商在吗");
    const [out] = await waitForSends(before, 1);
    assert.match(out, /^自己的供应商（OpenAI 格式）收到：\[[^\]]+\] 自己的供应商在吗$/);
    const calls = (await log()).filter((e) => e.kind === "custom.chat");
    assert.equal(calls.length, 2, "the trial call and the turn");
    assert.equal(calls[1].auth, "Bearer test-custom-key");
    assert.equal(calls[1].body.model, "nous/claude-test");
    assert.equal(calls[1].body.stream, true);
  });

  await step("without Aelios the picker is told to keep to its own catalog", async () => {
    const list = await (await web("/web/models", "test-web-key")).json();
    assert.deepEqual(list, { aelios: false, models: [], curated: false });
    assert.equal((await log()).filter((e) => e.kind === "aelios.models").length, 0, "nothing is asked of an Aelios that is not connected");
  });

  await step("the format is changed on the settings page and applies from the next message", async () => {
    const config = await (await web("/web/config", "test-web-key", { key: "CUSTOM_FORMAT", text: "Anthropic" })).json();
    assert.equal(config.fields.find((f) => f.key === "CUSTOM_FORMAT").value, "anthropic");
  });

  await step("a provider of your own on the Messages API: your key, the cache marker, no thinking from earlier turns", async () => {
    await fetch(`${MOCK}/__reset`);
    const response = await web("/web/model", "test-web-key", { text: "custom/claude-test" });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    let before = (await sent()).length;
    await post("第一句");
    const [first] = await waitForSends(before, 1);
    const count = Number(first.match(/^自己的供应商（Anthropic 格式）收到 (\d+) 条，缓存标记有，旧思考块 0 个$/)?.[1]);
    assert.ok(count > 0, first);
    before = (await sent()).length;
    await post("第二句");
    assert.deepEqual(await waitForSends(before, 1), [`自己的供应商（Anthropic 格式）收到 ${count + 2} 条，缓存标记有，旧思考块 0 个`]);
    const calls = (await log()).filter((e) => e.kind === "custom.messages");
    assert.equal(calls.at(-1).apiKey, "test-custom-key");
    assert.equal(calls.at(-1).body.model, "claude-test");
    // The first answer went back without its thinking, its words kept.
    const earlier = calls.at(-1).body.messages.at(-2);
    assert.equal(earlier.role, "assistant");
    assert.ok(earlier.content.some((b) => b.type === "text"), JSON.stringify(earlier));
    // THINKING_EFFORT applies here too.
    await web("/web/config", "test-web-key", { key: "THINKING_EFFORT", text: "xhigh" });
    assert.equal((await web("/web/model", "test-web-key", { text: "custom/claude-sonnet-5-5" })).status, 200);
    before = (await sent()).length;
    await post("第三句");
    await waitForSends(before, 1);
    const turn = (await log()).filter((e) => e.kind === "custom.messages").at(-1);
    assert.deepEqual(turn.body.thinking, { type: "adaptive", display: "summarized" });
    assert.deepEqual(turn.body.output_config, { effort: "xhigh" });
  });
}

if (phase === "mcp") {
  await fetch(`${MOCK}/__reset`);
  const KEY = "test-web-key";
  const servers = async () => (await (await web("/web/mcp", KEY)).json()).servers;
  const say = async (text) => {
    const before = (await sent()).length;
    await post(text);
    return (await waitForSends(before, 1)).join("\n");
  };

  await step("an open server is added on the settings page and its tools are counted", async () => {
    const response = await web("/web/mcp", KEY, { name: "demo", url: `${MOCK}/ext/mcp` });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    const demo = body.servers.find((s) => s.id === "demo");
    assert.equal(demo.state, "ready", JSON.stringify(demo));
    assert.equal(demo.tools, 2);
    assert.equal(demo.hasKey, false);
    assert.ok(demo.tokens > 0 && demo.tokens < 400, `tokens ${demo.tokens}`);
    const methods = (await log()).filter((e) => e.kind === "ext.ext").map((e) => e.method);
    assert.ok(methods.includes("tools/list"), JSON.stringify(methods));
  });

  await step("the model gets its tools with the descriptions cut and every parameter kept", async () => {
    const out = await say("MCP工具有哪些");
    const echo = out.split("; ").find((t) => t.startsWith("mcp_demo_echo:"));
    assert.ok(echo, out);
    const [, length, params] = echo.split(":");
    assert.ok(Number(length) <= 310, `description ${length}`);
    assert.equal(params, "text|title");
    assert.match(out, /mcp_demo_add:/);
    assert.match(out, /connect_mcp_server:/);
    assert.match(out, /disconnect_mcp_server:/);
  });

  await step("the model calls one and reads its answer", async () => {
    const out = await say("用MCP");
    assert.match(out, /ext echo: hi/);
    const call = (await log()).find((e) => e.kind === "ext.ext" && e.method === "tools/call");
    assert.deepEqual(call.args, { text: "hi", title: "t" });
  });

  await step("a server that wants a key fails without one and is not kept, and works with it", async () => {
    let body = await (await web("/web/mcp", KEY, { name: "keyed", url: `${MOCK}/keyed/mcp` })).json();
    assert.ok(body.error, JSON.stringify(body));
    assert.ok(!(await servers()).some((s) => s.id === "keyed"));
    body = await (await web("/web/mcp", KEY, { name: "keyed", url: `${MOCK}/keyed/mcp`, key: "x-api-key: k1" })).json();
    const keyed = body.servers?.find((s) => s.id === "keyed");
    assert.equal(keyed?.state, "ready", JSON.stringify(body));
    assert.equal(keyed.hasKey, true);
    assert.ok(!JSON.stringify(body).includes("k1"), "the key is never sent back");
    // Connected again without a key: tried where it is, the key kept.
    body = await (await web("/web/mcp", KEY, { name: "keyed", url: `${MOCK}/keyed/mcp` })).json();
    assert.deepEqual(body.servers?.filter((s) => s.id === "keyed").map((s) => [s.state, s.hasKey]), [["ready", true]], JSON.stringify(body));
    body = await (await web("/web/mcp/retry", KEY, { id: "keyed" })).json();
    assert.equal(body.servers?.find((s) => s.id === "keyed")?.state, "ready", JSON.stringify(body));
  });

  await step("an unreachable server is reported and not kept", async () => {
    const body = await (await web("/web/mcp", KEY, { name: "nope", url: `${MOCK}/nope/mcp?api_key=SECRET1` })).json();
    assert.ok(body.error, JSON.stringify(body));
    assert.ok(!body.error.includes("SECRET1"), `the address's key is not repeated: ${body.error}`);
    assert.ok(!(await servers()).some((s) => s.id === "nope"));
    const bad = await (await web("/web/mcp", KEY, { url: "http://example.com/mcp" })).json();
    assert.match(bad.error, /https/);
  });

  await step("a server that wants a sign-in gives a link, and the sign-in comes back to the resident", async () => {
    const body = await (await web("/web/mcp", KEY, { name: "oauth", url: `${MOCK}/oauth/mcp` })).json();
    const pending = body.servers?.find((s) => s.id === "oauth");
    assert.equal(pending?.state, "authenticating", JSON.stringify(body));
    assert.ok(pending.authUrl?.startsWith(`${MOCK}/oauth/authorize`), pending.authUrl);
    // Asked again before signing in: the same server, still waiting, a link that still works.
    const again = await (await web("/web/mcp/retry", KEY, { id: "oauth" })).json();
    const still = again.servers?.find((s) => s.id === "oauth");
    assert.equal(still?.state, "authenticating", JSON.stringify(again));
    assert.ok(still.authUrl?.startsWith(`${MOCK}/oauth/authorize`), still.authUrl);
    const authorize = await fetch(still.authUrl, { redirect: "manual" });
    assert.equal(authorize.status, 302);
    const back = authorize.headers.get("location");
    assert.ok(back.startsWith(`${WORKER}/mcp/callback`), back);
    const page = await fetch(back, { redirect: "manual" });
    const html = await page.text();
    assert.equal(page.status, 200, html.slice(0, 300));
    assert.match(html, /接好了/);
    // Only the address reaches the resident: a WebSocket upgrade on the callback is not let through.
    const upgraded = await new Promise((resolve) => {
      const request = http.request(`${WORKER}/mcp/callback?state=x.oauth`, {
        headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13" }
      });
      request.on("upgrade", (_response, socket) => (socket.destroy(), resolve(true)));
      request.on("response", (response) => (response.resume(), resolve(false)));
      request.on("error", () => resolve(false));
      request.end();
    });
    assert.equal(upgraded, false, "the callback opened a WebSocket to the resident");
    let oauth;
    for (let i = 0; i < 20; i += 1) {
      oauth = (await servers()).find((s) => s.id === "oauth");
      if (oauth?.state === "ready") break;
      await sleep(250);
    }
    assert.equal(oauth?.state, "ready", JSON.stringify(oauth));
    assert.equal(oauth.tools, 2);
    const used = (await log()).filter((e) => e.kind === "ext.oauth" && e.auth === "Bearer tok-1");
    assert.ok(used.length, "the token is used");
  });

  await step("the model connects one when she asks", async () => {
    const out = await say("接上MCP");
    assert.match(out, /Connected second/);
    assert.equal((await servers()).find((s) => s.id === "second")?.state, "ready");
  });

  await step("never because a page it read said so", async () => {
    const out = await say("读完再接MCP");
    assert.match(out, /Not done: this turn has read a web page/);
    assert.ok(!(await servers()).some((s) => s.id === "sneaky"));
  });

  await step("/status lists them", async () => {
    const out = await say("/status");
    assert.match(out, /别的 MCP：.*demo（2 个工具）/);
  });

  await step("the model disconnects one when she asks, and the page removes one", async () => {
    const out = await say("断开MCP");
    assert.match(out, /Disconnected second/);
    assert.ok(!(await servers()).some((s) => s.id === "second"));
    const body = await (await web("/web/mcp/remove", KEY, { id: "keyed" })).json();
    assert.deepEqual(body.servers.map((s) => s.id).sort(), ["demo", "oauth"]);
  });
}

if (phase === "mcp-2") {
  // After restart.sh: the servers come back on their own, the signed-in one with its token.
  await fetch(`${MOCK}/__reset`);
  await step("connections come back after a restart", async () => {
    await post("用MCP");
    const out = (await waitForSends(0, 1)).join("\n");
    assert.match(out, /ext echo: hi/);
    const list = (await (await web("/web/mcp", "test-web-key")).json()).servers;
    assert.deepEqual(list.map((s) => [s.id, s.state]).sort(), [["demo", "ready"], ["oauth", "ready"]]);
    const before = (await sent()).length;
    await post("用授权MCP");
    assert.match((await waitForSends(before, 1)).join("\n"), /我查到了：3/);
    const call = (await log()).find((e) => e.kind === "ext.oauth" && e.method === "tools/call");
    assert.equal(call?.auth, "Bearer tok-1", "the signed-in server is called with its saved token");
  });
}

if (phase === "stickers") {
  await fetch(`${MOCK}/__reset`);
  const KEY = "test-web-key";
  const packs = async () => (await (await web("/web/stickers", KEY)).json()).packs;
  const pack = async (id) => (await packs()).find((p) => p.id === id);
  const tgLog = async (kind) => (await log()).filter((e) => e.kind === `tg.${kind}`);
  // Until Telegram has had one more `kind` call than `count`.
  const oneMore = async (kind, count) => {
    const start = Date.now();
    while ((await tgLog(kind)).length === count) {
      if (Date.now() - start > 20000) throw new Error(`no ${kind}`);
      await sleep(200);
    }
  };
  const ask = async (text) => {
    const r = await web("/web/say", KEY, { text });
    assert.equal(r.status, 200);
    const lines = (await (await web("/web/messages", KEY)).json()).data;
    return lines.filter((line) => line.role === "assistant").at(-1);
  };
  const manifest = {
    format: "resident-stickers/1",
    name: "Test",
    stickers: [
      { id: "wave", file: "wave.gif", emoji: "👋", when: "Say hi.", telegram: "wave.webm" },
      { id: "love", file: "love.png", emoji: "❤️", when: "Love." }
    ]
  };

  await step("a pack is imported from a zip on the settings page", async () => {
    await post("你好");
    await waitForSends(0, 2);
    const body = zip([
      { name: "pack.json", data: JSON.stringify(manifest), deflate: true },
      { name: "wave.gif", data: GIF },
      { name: "wave.webm", data: WEBM },
      { name: "love.png", data: PNG, deflate: true }
    ]);
    const response = await fetch(`${WORKER}/web/stickers/import?name=test.zip`, { method: "POST", headers: { "x-web-key": KEY, "content-type": "application/zip" }, body });
    assert.equal(response.status, 200, await response.clone().text());
    const imported = await response.json();
    assert.equal(imported.left, 0, "every sticker is told to the model");
    const test = imported.packs.find((p) => p.id === "test");
    assert.deepEqual(test.stickers.map((s) => [s.name, s.emoji, s.when]), [["wave", "👋", "Say hi."], ["love", "❤️", "Love."]]);
    assert.ok(test.enabled && test.tokens > 0);
    const shut = await fetch(`${WORKER}/web/stickers/import?name=x.zip`, { method: "POST", headers: { "content-type": "application/zip" }, body });
    assert.equal(shut.status, 401, "not without the web key");
    const bad = await fetch(`${WORKER}/web/stickers/import?name=x.zip`, { method: "POST", headers: { "x-web-key": KEY, "content-type": "application/zip" }, body: "not a zip" });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /不是 zip/);
  });

  await step("a sticker's picture is served by its key alone", async () => {
    const wave = (await pack("test")).stickers[0];
    const picture = await fetch(`${WORKER}/stickers/${wave.key}`);
    assert.equal(picture.status, 200);
    assert.equal(picture.headers.get("content-type"), "image/gif");
    assert.deepEqual(Buffer.from(await picture.arrayBuffer()), GIF);
    assert.equal((await fetch(`${WORKER}/stickers/${"0".repeat(24)}`)).status, 404);
    assert.equal((await fetch(`${WORKER}/stickers/not-a-key`)).status, 404);
  });

  await step("a Telegram sticker pack is imported by its link, its pictures fetched from Telegram once", async () => {
    const response = await web("/web/stickers/import", KEY, { url: "https://t.me/addstickers/TestPack" });
    assert.equal(response.status, 200, await response.clone().text());
    const tg = (await response.json()).packs.find((p) => p.id === "testpack");
    assert.equal(tg.name, "Test Pack");
    assert.deepEqual(tg.stickers.map((s) => [s.name, s.emoji, s.video]), [["1", "😀", false], ["2", "🥰", true], ["3", "😴", false]]);
    const video = await fetch(`${WORKER}/stickers/${tg.stickers[1].key}`);
    assert.equal(video.headers.get("content-type"), "video/webm");
    const thumb = await fetch(`${WORKER}/stickers/${tg.stickers[2].key}`);
    assert.equal(thumb.headers.get("content-type"), "image/webp");
    const fetched = (await tgLog("getFile")).length;
    await fetch(`${WORKER}/stickers/${tg.stickers[1].key}`);
    assert.equal((await tgLog("getFile")).length, fetched, "kept after the first time");
    assert.deepEqual((await tgLog("getFile")).map((e) => e.body.file_id).sort(), ["tg-anim-thumb", "tg-video"]);
    for (const [url, error] of [
      ["https://t.me/addstickers/Nope", /找不到/],
      ["https://t.me/addemoji/Abc", /表情符号包/],
      ["hello", /认不出/],
      ["http://example.com/a.zip", /https/],
      ["https://127.0.0.1:9999/a.zip", /不能读/]
    ]) {
      const refused = await web("/web/stickers/import", KEY, { url });
      assert.equal(refused.status, 400, url);
      assert.match((await refused.json()).error, error);
    }
  });

  await step("on Telegram the sticker its reply marks goes right after that paragraph, uploaded the first time and sent by its id after", async () => {
    const before = (await sent()).length;
    await post("发表情");
    const out = await waitForSends(before, 2);
    assert.deepEqual(out, ["嗨～", "再说一句。"], "the mark is taken out of the words");
    await sleep(500);
    const all = await log();
    const sticker = all.findLastIndex((e) => e.kind === "tg.sendSticker");
    const said = (text) => all.findLastIndex((e) => e.kind === "tg.sendMessage" && plain(e.body.text ?? "") === text);
    assert.ok(said("嗨～") < sticker && sticker < said("再说一句。"), "the sticker comes after its paragraph");
    const first = all[sticker].body;
    assert.equal(first.multipart, true);
    assert.equal(first.sticker.file, "sticker.webm");
    assert.equal(first.sticker.type, "video/webm");
    assert.equal(first.emoji, "👋");
    await post("发表情");
    await waitForSends(before + 2, 2);
    await sleep(500);
    const again = (await tgLog("sendSticker")).at(-1).body;
    assert.equal(again.multipart, undefined);
    assert.match(again.sticker, /^up-sendSticker-/);
  });

  await step("a sticker can be the whole reply, with no 'said nothing' line", async () => {
    const before = (await sent()).length;
    const stickers = (await tgLog("sendSticker")).length;
    await post("只发表情");
    await oneMore("sendSticker", stickers);
    await sleep(1500);
    assert.deepEqual((await sent()).slice(before), []);
  });

  await step("a mark of a sticker it does not have is only taken out; a reply that was nothing else says it said nothing", async () => {
    const before = (await sent()).length;
    const stickers = (await tgLog("sendSticker")).length;
    await post("发没有的表情");
    assert.deepEqual(await waitForSends(before, 1), ["（我好像没说出话来，再发一次？）"]);
    assert.equal((await tgLog("sendSticker")).length, stickers);
  });

  await step("the resident draws a sticker, keeps it in its own pack and sends it (as a GIF on Telegram)", async () => {
    const before = (await sent()).length;
    await post("画一张");
    await waitForSends(before, 1);
    await sleep(800);
    const animations = await tgLog("sendAnimation");
    const animation = animations.at(-1)?.body;
    assert.equal(animations.length, 1, "sent once, as an animation: its mark in the words after it does not send another");
    assert.equal(animation.animation.file, "sticker.gif");
    assert.equal(animation.animation.head, "GIF89a");
    const mine = await pack("mine");
    assert.equal(mine.source, "own");
    assert.deepEqual(mine.stickers.map((s) => [s.name, s.emoji, s.when]), [["heart", "❤️", "When she says she loves me."]]);
    const picture = await fetch(`${WORKER}/stickers/${mine.stickers[0].key}`);
    assert.equal(Buffer.from(await picture.arrayBuffer()).subarray(0, 6).toString(), "GIF89a");
  });

  await step("words, a sticker drawn, then the same words again or 'No response requested.': only the first words go out and stay", async () => {
    for (const asked of ["说完再画", "说完再画，没话说"]) {
      const before = (await sent()).length;
      const drawn = (await tgLog("sendAnimation")).length;
      await post(asked);
      const out = await waitForSends(before, 1);
      assert.equal(out[0], "抱抱你，今天辛苦啦。");
      await oneMore("sendAnimation", drawn);
      await sleep(1500);
      assert.deepEqual((await sent()).slice(before), ["抱抱你，今天辛苦啦。"], asked);
      const kept = (await (await web("/web/messages", KEY)).json()).data.filter((line) => line.role === "assistant").at(-1);
      assert.equal(kept.text, "抱抱你，今天辛苦啦。", "kept once, without the line that said nothing");
    }
  });

  await step("a mark that went out counts as the reply's one sticker: one drawn after it in the same reply is not sent", async () => {
    const before = (await sent()).length;
    const [stickers, drawn] = [(await tgLog("sendSticker")).length, (await tgLog("sendAnimation")).length];
    await post("标记完再画");
    const out = await waitForSends(before, 2);
    assert.equal(out[0], "先发这张");
    assert.match(out[1], /one sticker per reply/);
    await sleep(800);
    assert.deepEqual([(await tgLog("sendSticker")).length, (await tgLog("sendAnimation")).length], [stickers + 1, drawn]);
  });

  await step("one sticker per reply: a second mark is only taken out", async () => {
    const before = (await sent()).length;
    const stickers = (await tgLog("sendSticker")).length;
    await post("发两张");
    assert.deepEqual(await waitForSends(before, 2), ["两张都给你。", "还有这张"]);
    await sleep(800);
    assert.equal((await tgLog("sendSticker")).length, stickers + 1);
  });

  await step("the web page shows the stickers a reply sent, and a web turn sends nothing to Telegram", async () => {
    const lines = (await (await web("/web/messages", KEY)).json()).data.filter((line) => line.role === "assistant" && line.stickers);
    const mine = await pack("mine");
    assert.deepEqual(lines.findLast((line) => line.text === "抱抱你，今天辛苦啦。").stickers, [{ url: `/stickers/${mine.stickers[0].key}`, video: false }], "the one it drew");
    assert.deepEqual(lines.findLast((line) => line.text.startsWith("先发这张")).stickers, [{ url: `/stickers/${(await pack("test")).stickers[0].key}`, video: false }], "the one marked first, as on Telegram");
    assert.deepEqual([lines.at(-1).text, lines.at(-1).stickers], ["两张都给你。\n\n还有这张", [{ url: `/stickers/${(await pack("test")).stickers[0].key}`, video: false }]], "one per reply, the first one marked");
    const tgBefore = (await log()).filter((e) => e.kind.startsWith("tg.send")).length;
    const line = await ask("发表情");
    assert.equal(line.via, "web");
    assert.equal(line.text, "嗨～\n\n再说一句。", "without the mark");
    assert.deepEqual(line.stickers, [{ url: `/stickers/${(await pack("test")).stickers[0].key}`, video: false }]);
    await sleep(500);
    assert.equal((await log()).filter((e) => e.kind.startsWith("tg.send")).length, tgBefore);
  });

  await step("the system prompt lists every sticker of the packs that are on; a pack or the whole thing can be turned off", async () => {
    const tools = async () => (await ask("表情工具有哪些")).text;
    // The list is held while the cache is warm: the one it drew joins it in the next window, so the prompt stays the same.
    assert.equal(await tools(), "make_sticker；清单：test/wave|test/love|testpack/1|testpack/2|testpack/3", "no send_sticker tool");
    await web("/web/stickers/pack", KEY, { id: "testpack", on: false });
    // A change on the settings page shows from the next message, as any setting does, and the drawn one comes with it.
    assert.equal(await tools(), "make_sticker；清单：mine/heart|test/wave|test/love");
    // A mark of a sticker whose pack is off, or with stickers off, goes nowhere: not on Telegram, not on the page.
    await web("/web/stickers/pack", KEY, { id: "test", on: false });
    const before = (await sent()).length;
    const stickers = (await tgLog("sendSticker")).length;
    await post("发表情");
    assert.deepEqual(await waitForSends(before, 2), ["嗨～", "再说一句。"]);
    await sleep(800);
    assert.equal((await tgLog("sendSticker")).length, stickers);
    assert.deepEqual([(await ask("发表情")).stickers], [undefined], "its pack is off");
    await web("/web/stickers/pack", KEY, { id: "test", on: true });
    const off = await web("/web/config", KEY, { key: "STICKERS", text: "off" });
    assert.equal(off.status, 200);
    assert.equal(await tools(), "没有");
    assert.deepEqual([(await ask("发表情")).stickers], [undefined], "stickers are off");
    assert.match(await (await fetch(`${WORKER}/web/stickers`, { headers: { "x-web-key": KEY } })).text(), /"on":false/);
    await web("/web/config", KEY, { key: "STICKERS", text: "" });
    await web("/web/stickers/pack", KEY, { id: "testpack", on: true });
  });

  await step("what a sticker is for is changed on the settings page; stickers and packs are deleted there", async () => {
    const wave = (await pack("test")).stickers[0];
    const edited = await (await web("/web/stickers/edit", KEY, { key: wave.key, when: "挥手打招呼" })).json();
    assert.equal(edited.packs.find((p) => p.id === "test").stickers[0].when, "挥手打招呼");
    const badEmoji = await web("/web/stickers/edit", KEY, { key: wave.key, when: "x", emoji: "abc" });
    assert.equal(badEmoji.status, 400);
    await web("/web/stickers/delete", KEY, { key: wave.key });
    assert.deepEqual((await pack("test")).stickers.map((s) => s.name), ["love"]);
    assert.equal((await fetch(`${WORKER}/stickers/${wave.key}`)).status, 404);
    await web("/web/stickers/remove", KEY, { id: "testpack" });
    assert.equal(await pack("testpack"), undefined);
  });

  await step("/status says how the stickers are", async () => {
    const before = (await sent()).length;
    await post("/status");
    const out = (await waitForSends(before, 1)).join("\n");
    assert.match(out, /表情包：开，2 个包 2 张/);
  });

  await step("a WebP Telegram will not take as a sticker goes as a photo, and the same way after", async () => {
    const body = zip([{ name: "smile.webp", data: WEBP }]);
    const response = await fetch(`${WORKER}/web/stickers/import?name=still.zip`, { method: "POST", headers: { "x-web-key": KEY, "content-type": "application/zip" }, body });
    assert.equal(response.status, 200, await response.clone().text());
    const photos = (await tgLog("sendPhoto")).length;
    await post("发静图");
    await oneMore("sendPhoto", photos);
    assert.equal((await tgLog("sendSticker")).at(-1).body.sticker?.type, "image/webp", "tried as a sticker first");
    const photo = await tgLog("sendPhoto");
    assert.equal(photo.length, photos + 1);
    assert.equal(photo.at(-1).body.photo.type, "image/webp");
    const stickers = (await tgLog("sendSticker")).length;
    await post("发静图");
    await oneMore("sendPhoto", photos + 1);
    await sleep(500);
    assert.equal((await tgLog("sendSticker")).length, stickers, "not tried as a sticker again");
    assert.match((await tgLog("sendPhoto")).at(-1).body.photo, /^up-sendPhoto-/);
  });
}

if (phase === "voice") {
  await fetch(`${MOCK}/__reset`);
  const KEY = "test-web-key";
  const set = async (settings) => {
    for (const [key, text] of Object.entries(settings)) {
      const response = await web("/web/config", KEY, { key, text });
      assert.equal(response.status, 200, `${key}: ${await response.clone().text()}`);
    }
  };
  const ofKind = async (kind) => (await log()).filter((e) => e.kind === kind);
  const voiceCalls = async () => ofKind("voice");
  const voicesSent = async () => ofKind("tg.sendVoice");
  const ask = async (text) => {
    const before = (await sent()).length;
    await post(text);
    return (await waitForSends(before, 1)).join("\n");
  };
  // Settle: a reply that is a voice message shows up as sendVoice, not sendMessage.
  const waitForVoices = async (before, count, timeoutMs = 20000) => {
    const start = Date.now();
    for (;;) {
      const all = await voicesSent();
      if (all.length >= before + count) return all.slice(before);
      if (Date.now() - start > timeoutMs) throw new Error(`timed out: wanted ${count} voice messages, have ${all.length - before}`);
      await sleep(200);
    }
  };
  await set({ VOICE_BASE_URL: "http://127.0.0.1:9999/voice", VOICE_API_KEY: "test-voice-key" });
  // Every voice message it sends shows on the web page too, with the reply it says, playable from /web/media.
  const webVoiceOfLastReply = async () => {
    for (let i = 0; i < 40; i += 1) {
      const lines = (await (await web("/web/messages", KEY)).json()).data;
      const reply = lines.findLast((line) => line.role === "assistant" && line.kind === "chat");
      if (reply?.voice?.key) return reply.voice;
      await sleep(250);
    }
    return null;
  };
  const playsOnWeb = async (voice) => {
    assert.ok(voice && /^[0-9a-f]{32}$/.test(voice.key), "the web page shows the voice with its reply");
    const audio = await web(`/web/media?key=${voice.key}`, KEY);
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get("content-type"), "audio/mpeg");
  };

  await step("with no voice provider, a voice message she sends still reaches the model (here: not heard, no AI binding), and nothing about sending voice is added", async () => {
    const before = (await sent()).length;
    await post("", { voice: "voice-a" });
    const out = await waitForSends(before, 2);
    assert.match(out[0], /^收到：\[\d\d-\d\d 周. \d\d:\d\d\] \[voice 0:03, could not be heard\]$/);
    assert.equal((await voicesSent()).length, 0);
    assert.equal(await ask("语音工具有哪些"), "工具:没有；提示:没有");
  });

  await step("ElevenLabs picked without a voice: /status says what is missing, and still no tool", async () => {
    await set({ VOICE_PROVIDER: "elevenlabs" });
    assert.equal(await ask("语音工具有哪些"), "工具:没有；提示:没有");
    const status = await ask("/status");
    assert.match(status, /语音：收到的用 ElevenLabs Scribe（不行就 Whisper） 听；发语音还差 VOICE_ID/);
  });

  await step("with ElevenLabs set up, her voice message is heard by Scribe and answered with a voice message", async () => {
    await set({ VOICE_ID: "voice-123" });
    const before = (await sent()).length;
    const voices = (await voicesSent()).length;
    await post("", { voice: "voice-b" });
    const [voice] = await waitForVoices(voices, 1);
    await sleep(1500);
    assert.equal((await sent()).length, before, "the reply is the voice message only");
    assert.equal(voice.body.chat_id, "42");
    assert.equal(voice.body.duration, "1");
    assert.deepEqual([voice.body.voice.type, voice.body.voice.head.slice(0, 3)], ["audio/mpeg", "ID3"]);
    const [stt, tts] = (await voiceCalls()).slice(-2);
    assert.equal(stt.endpoint, "v1/speech-to-text");
    assert.equal(stt.headers["xi-api-key"], "test-voice-key");
    assert.equal(stt.body.model_id, "scribe_v2");
    assert.equal(tts.endpoint, "v1/text-to-speech/voice-123");
    assert.equal(tts.query, "?output_format=mp3_44100_128");
    assert.equal(tts.body.model_id, "eleven_v4");
    assert.match(tts.body.text, /今天好累呀/);
    assert.ok(!/这是第二个气泡。\n\n/.test(tts.body.text), "said as one message");
    assert.ok((await ofKind("tg.sendChatAction")).some((e) => e.body.action === "record_voice"), "shows recording");
    await playsOnWeb(await webVoiceOfLastReply());
    assert.equal((await voiceCalls()).filter((call) => call.endpoint.startsWith("v1/text-to-speech")).length, 1, "said once, for both");
  });

  await step("in mirror mode a typed message is answered in text", async () => {
    const voices = (await voicesSent()).length;
    const out = await ask("打字的");
    assert.match(out, /打字的/);
    await sleep(1000);
    assert.equal((await voicesSent()).length, voices);
  });

  await step("the model is given send_voice and ElevenLabs v4's square-bracket tags; it sends one, and writes nothing after", async () => {
    assert.equal(await ask("语音工具有哪些"), "工具:text；提示:[laughs]");
    const before = (await sent()).length;
    const voices = (await voicesSent()).length;
    await post("发条语音");
    await waitForVoices(voices, 1);
    await sleep(2000);
    assert.equal((await sent()).length, before, "no '我好像没说出话来' after it");
    assert.equal((await voiceCalls()).at(-1).body.text, "晚安呀，[laughs] 早点睡。");
    await playsOnWeb(await webVoiceOfLastReply());
  });

  await step("an older ElevenLabs model reads no tags, so none are taught", async () => {
    await set({ VOICE_MODEL: "eleven_multilingual_v2" });
    assert.equal(await ask("语音工具有哪些"), "工具:text；提示:没有标记");
    await set({ VOICE_MODEL: "" });
  });

  await step("OpenRouter with a Gemini voice: angle-bracket marks and a style; always mode speaks every reply in OpenAI's format", async () => {
    await set({ VOICE_PROVIDER: "openrouter", VOICE_ID: "" });
    assert.match(await ask("/status"), /发语音还差 VOICE_MODEL/);
    await set({ VOICE_MODEL: "google/gemini-3.8-flash-tts", VOICE_ID: "Kore" });
    assert.equal(await ask("语音工具有哪些"), "工具:text|style；提示:<laugh>");
    await set({ VOICE_REPLY: "always" });
    let voices = (await voicesSent()).length;
    await post("语音工具有哪些");
    await waitForVoices(voices, 1);
    assert.equal((await voiceCalls()).at(-1).body.input, "工具:没有；提示:<laugh>", "every reply is a voice message, so no send_voice");
    voices = (await voicesSent()).length;
    await post("你好呀");
    await waitForVoices(voices, 1);
    const call = (await voiceCalls()).at(-1);
    assert.equal(call.endpoint, "v1/audio/speech");
    assert.equal(call.headers.authorization, "Bearer test-voice-key");
    assert.deepEqual([call.body.model, call.body.voice, call.body.response_format], ["google/gemini-3.8-flash-tts", "Kore", "mp3"]);
    assert.match(call.body.input, /你好呀/);
  });

  await step("when the voice cannot be made, the reply goes out as text and /status says why", async () => {
    const before = (await sent()).length;
    await post("炸了");
    const out = await waitForSends(before, 2);
    assert.match(out[0], /炸了/);
    assert.match(await ask("/status"), /那条没发出去：OpenRouter 500/);
  });

  await step("a reply with a link is said, then the link follows as text without the marks", async () => {
    const before = (await sent()).length;
    const voices = (await voicesSent()).length;
    await post("带链接");
    await waitForVoices(voices, 1);
    const [text] = await waitForSends(before, 1);
    // MarkdownV2 makes it a link, so the address shows twice in the raw text.
    assert.match(text, /^你看这个 \[?https:\/\/example\.com\/a.* 好不好$/);
    assert.ok(!text.includes("laugh"), text);
    assert.equal((await voiceCalls()).at(-1).body.input, "你看这个 <laugh> 好不好");
  });

  await step("Cartesia: its own request, sonic-3.6 by default, the language read from the words, its own tags", async () => {
    await set({ VOICE_PROVIDER: "cartesia", VOICE_MODEL: "", VOICE_ID: "cart-voice", VOICE_REPLY: "tool" });
    assert.equal(await ask("语音工具有哪些"), "工具:text；提示:[laughter]");
    const voices = (await voicesSent()).length;
    await post("发条语音");
    await waitForVoices(voices, 1);
    const call = (await voiceCalls()).at(-1);
    assert.equal(call.endpoint, "tts/bytes");
    assert.equal(call.headers["cartesia-version"], "2026-08-14");
    assert.equal(call.headers.authorization, "Bearer test-voice-key");
    assert.deepEqual(call.body.voice, { mode: "id", id: "cart-voice" });
    assert.deepEqual([call.body.model_id, call.body.language, call.body.output_format.container], ["sonic-3.6", "zh", "mp3"]);
  });

  await step("the web page shows her voice messages as a voice bubble with their length and what was heard", async () => {
    const lines = (await (await web("/web/messages", KEY)).json()).data;
    const theirs = lines.filter((line) => line.role === "user" && line.voice);
    assert.ok(theirs.some((line) => line.voice.seconds === 3 && line.text === "今天好累呀" && !line.voice.missed), JSON.stringify(theirs.slice(-6)));
    assert.ok(theirs.some((line) => line.voice.seconds === 3 && line.voice.missed));
    assert.ok(!JSON.stringify(theirs).includes("🎤"), "the mark the model reads is not shown");
  });

  await set({ VOICE_PROVIDER: "", VOICE_API_KEY: "", VOICE_MODEL: "", VOICE_ID: "", VOICE_REPLY: "", VOICE_BASE_URL: "" });
}

if (phase === "tasks" || phase === "tasks-quiet" || phase === "tasks-roles") {
  await fetch(`${MOCK}/__reset`);
  const KEY = "test-web-key";
  const URL_OK = "https://api.anthropic.com/v1/claude_code/routines/trig_testtask01/fire";
  const set = async (settings) => {
    for (const [key, text] of Object.entries(settings)) {
      const response = await web("/web/config", KEY, { key, text });
      assert.equal(response.status, 200, `${key}: ${await response.clone().text()}`);
    }
  };
  const fires = async () => (await log()).filter((e) => e.kind === "routine.fire");
  const tasks = async () => (await (await web("/web/tasks", KEY)).json());
  const ask = async (text, count = 1) => {
    const before = (await sent()).length;
    await post(text);
    return (await waitForSends(before, count)).join("\n");
  };
  const report = (id, kind, code, body) =>
    fetch(`${WORKER}/tasks/${id}/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(code ? { "x-task-code": code } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body)
    });
  const sentJob = (fire) => {
    const [, id, code] = fire.body.text.match(/^task: (t_[0-9a-f]{10})\ncode: ([0-9a-f]{32})\n/) ?? [];
    assert.ok(id && code, fire.body.text);
    return { id, code };
  };

  if (phase === "tasks") {
    await step("off by default: no cloud_task tool, nor find or make_file, even with the trigger filled in, until it is turned on; a wrong address is not taken", async () => {
      assert.match(await ask("云端工具有哪些"), /没有 cloud_task。找不了旧线程和聊天记录。出不了文件。/);
      const bad = await web("/web/config", KEY, { key: "CLOUD_TASK_URL", text: "https://example.com/fire" });
      assert.equal(bad.status, 400);
      assert.match((await bad.json()).error, /API 触发网址/);
      await set({ CLOUD_TASK_URL: URL_OK, CLOUD_TASK_TOKEN: "good-token" });
      assert.ok(!JSON.stringify(await (await web("/web/config", KEY)).json()).includes("good-token"), "the token is not sent back");
      assert.match(await ask("云端工具有哪些"), /没有 cloud_task/);
      assert.match(await ask("/status"), /后台帮忙：关/);
      assert.deepEqual([(await tasks()).on, (await tasks()).configured], [false, false]);
      await set({ CLOUD_TASKS: "on" });
      assert.match(await ask("云端工具有哪些"), /有 cloud_task。也能找旧线程和聊天记录。能出文件。/);
    });

    await step("the settings page gives the scheduled task's prompt, with this resident's address in it", async () => {
      const shown = await tasks();
      assert.deepEqual([shown.on, shown.configured], [true, true]);
      assert.equal(shown.origin, WORKER);
      assert.ok(shown.prompt.includes(`curl -sS -X POST ${WORKER}/tasks/<task>/progress -H "x-task-code: <code>"`));
      assert.ok(shown.prompt.includes(`${WORKER}/tasks/<task>/result`));
      assert.match(shown.prompt, /routine-fire-payload/);
      assert.match(shown.prompt, /Never push to a default branch/);
      assert.deepEqual([shown.today, shown.limit, shown.tasks.length], [0, 10, 0]);
      assert.equal((await fetch(`${WORKER}/web/tasks`)).status, 401, "not without the web key");
    });

    let first;
    let next;
    let localThread;
    await step("asked on Telegram, the job goes out through the trigger with its task and code, and nothing of the chat", async () => {
      const out = await ask("派活");
      const [fire] = await fires();
      assert.equal(fire.trigger, "trig_testtask01");
      assert.deepEqual(fire.headers, { authorization: "Bearer good-token", "anthropic-beta": "experimental-cc-routine-2026-04-01", "anthropic-version": "2023-06-01" });
      assert.match(fire.body.text, /^task: t_[0-9a-f]{10}\ncode: [0-9a-f]{32}\ntitle: 修 README 的错字\nrepository: wusaki0723\/aelios-resident\n\n把 README 里/);
      assert.ok(!fire.body.text.includes("派活"), "her message is not in it");
      first = sentJob(fire);
      assert.ok(out.includes(first.id) && out.includes("https://claude.ai/code/session_test_1"), out);
      assert.ok(!out.includes(first.code), "the code is not in the chat");
    });

    await step("the task's card goes with the reply on the web page, and in the settings list", async () => {
      const lines = (await (await web("/web/messages", KEY)).json()).data;
      const reply = lines.filter((line) => line.role === "assistant").at(-1);
      assert.deepEqual(reply.tasks?.map((t) => [t.id, t.title, t.status, t.sessionUrl]), [[first.id, "修 README 的错字", "sent", "https://claude.ai/code/session_test_1"]]);
      assert.ok(!JSON.stringify(lines).includes(first.code), "the code is not on the page");
      const shown = await tasks();
      assert.equal(shown.today, 1);
      assert.deepEqual(shown.tasks.map((t) => [t.id, t.status]), [[first.id, "sent"]]);
      assert.equal(shown.tasks[0].job, undefined, "the job text stays inside");
    });

    await step("a report with the wrong code is refused; progress with the right one makes the card say it is working", async () => {
      assert.equal((await report(first.id, "progress", "0".repeat(32), { line: "x" })).status, 403);
      assert.equal((await report(first.id, "progress", "", { line: "x" })).status, 403);
      assert.equal((await report("t_0000000000", "progress", first.code, { line: "x" })).status, 403);
      assert.equal((await report(first.id, "progress", first.code, "not json")).status, 400);
      assert.equal((await report(first.id, "progress", first.code, { line: "  " })).status, 400);
      assert.equal((await report(first.id, "progress", first.code, { line: "x".repeat(20000) })).status, 413);
      assert.equal((await fetch(`${WORKER}/tasks/${first.id}/other`, { method: "POST", body: "{}" })).status, 404);
      const ok = await report(first.id, "progress", first.code, { line: "开始改了\n第一步" });
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), { ok: true });
      const card = (await tasks()).tasks[0];
      assert.deepEqual([card.status, card.progress], ["working", "开始改了 第一步"]);
    });

    await step("the result starts a turn of the resident's: she hears it on Telegram, the note stays hidden, the card is done with https links only", async () => {
      assert.equal((await report(first.id, "result", first.code, { status: "maybe", summary: "x" })).status, 400);
      assert.equal((await report(first.id, "result", first.code, { status: "done", summary: " " })).status, 400);
      const before = (await sent()).length;
      const ok = await report(first.id, "result", first.code, {
        status: "done",
        summary: "改好了，开了 PR。",
        links: ["https://github.com/wusaki0723/aelios-resident/pull/9", "javascript:alert(1)", "http://example.com/a"]
      });
      assert.equal(ok.status, 200);
      const out = (await waitForSends(before, 1)).join("\n");
      assert.ok(out.startsWith(`云端回来了：(Not from them: your cloud task ${first.id} "修 README 的错字" reported back: it is done.`), out);
      // Telegram's formatting turns the links into [link](link); the words are what matter.
      assert.ok(out.includes("<<<\n改好了，开了 PR。\nLinks: [https://github.com/wusaki0723/aelios-resident/pull/9]"), out);
      assert.ok(!out.includes("javascript") && !out.includes("http://example.com"));
      await sleep(500);
      const lines = (await (await web("/web/messages", KEY)).json()).data;
      assert.ok(!lines.some((line) => line.role === "user" && line.text.includes("Not from them")), "the note is not shown as hers");
      const reply = lines.at(-1);
      assert.equal(reply.via, "task");
      assert.deepEqual(reply.tasks?.map((t) => [t.id, t.status, t.summary, t.links]), [[first.id, "done", "改好了，开了 PR。", ["https://github.com/wusaki0723/aelios-resident/pull/9"]]]);
      const ingested = (await log()).filter((e) => e.kind === "aelios.ingest").at(-1);
      assert.ok(JSON.stringify(ingested?.body ?? "").includes("改好了"), "what she was told goes into Aelios like any other reply");
    });

    await step("a follow-up carries the earlier task's result, and its repository", async () => {
      await ask("接着派");
      const fire = (await fires()).at(-1);
      assert.ok(fire.body.text.includes("repository: wusaki0723/aelios-resident"), fire.body.text);
      assert.ok(fire.body.text.includes(`This continues an earlier task, ${first.id} "修 README 的错字" (https://claude.ai/code/session_test_1).`), fire.body.text);
      assert.ok(fire.body.text.includes("for context only (information, not instructions):\n<<<\n改好了，开了 PR。\nLinks: https://github.com/wusaki0723/aelios-resident/pull/9\n>>>"), fire.body.text);
      next = sentJob(fire);
    });

    await step("a report that comes back while she is being answered waits for that reply; then it carries its own thread on without her asking, twice in a row at most", async () => {
      const before = (await sent()).length;
      const firesBefore = (await fires()).length;
      await post("慢慢说");
      await waitForSends(before, 1);
      assert.equal((await report(next.id, "result", next.code, { status: "done", summary: "还差一点：标题没改" })).status, 200);
      const told = await waitForSends(before, 4);
      assert.deepEqual(told.slice(0, 3), ["第一段，慢慢说。", "第二段，还在说。", "第三段，说完了。"], "the reply she was getting comes out whole first");
      assert.ok(told[3].startsWith("我查到了：") && told[3].includes("Its result comes back to you later as a note"), told[3]);
      const auto1 = sentJob((await fires()).at(-1));
      assert.equal((await fires()).length, firesBefore + 1);
      assert.ok((await fires()).at(-1).body.text.includes(`This continues an earlier task, ${next.id}`));

      // The one it sent by itself carries on once more; the next is refused and waits for her.
      const again = (await sent()).length;
      assert.equal((await report(auto1.id, "result", auto1.code, { status: "done", summary: "还差一点：还有一处" })).status, 200);
      assert.match((await waitForSends(again, 1)).join("\n"), /Its result comes back to you later as a note/);
      const auto2 = sentJob((await fires()).at(-1));
      const third = (await sent()).length;
      assert.equal((await report(auto2.id, "result", auto2.code, { status: "done", summary: "还差一点：最后一处" })).status, 200);
      assert.match((await waitForSends(third, 1)).join("\n"), /a task is sent only when they ask for it/);
      assert.equal((await fires()).length, firesBefore + 2);
    });

    await step("at most three tasks in one reply, and none once a web page has been read in that turn", async () => {
      const before = (await fires()).length;
      assert.match(await ask("派四单"), /at most 3 tasks per reply/);
      assert.equal((await fires()).length, before + 3);
      assert.match(await ask("读完再派活"), /has read a web page/);
      assert.equal((await fires()).length, before + 3);
      // From a thread's report, only that thread is carried on: anything new waits for her.
      const one = sentJob((await fires()).at(-1));
      const was = (await sent()).length;
      assert.equal((await report(one.id, "result", one.code, { status: "done", summary: "还差一点，另开一单" })).status, 200);
      assert.match((await waitForSends(was, 1)).join("\n"), /a task is sent only when they ask for it/);
      assert.equal((await fires()).length, before + 3);
    });

    await step("a wrong token or a busy trigger says why, and nothing is kept", async () => {
      const today = (await tasks()).today;
      await set({ CLOUD_TASK_TOKEN: "bad-token" });
      assert.match(await ask("派活"), /token 不对/);
      await set({ CLOUD_TASK_TOKEN: "good-token", CLOUD_TASK_URL: URL_OK.replace("trig_testtask01", "trig_busyone") });
      assert.match(await ask("派活"), /这一个小时派得太多了/);
      await set({ CLOUD_TASK_URL: URL_OK });
      assert.equal((await tasks()).today, today);
    });

    await step("the settings page's 试一下 sends a test whose report starts no turn", async () => {
      assert.equal((await fetch(`${WORKER}/web/tasks/test`, { method: "POST" })).status, 401);
      const response = await web("/web/tasks/test", KEY, {});
      assert.equal(response.status, 200, await response.clone().text());
      const card = (await response.json()).tasks[0];
      assert.deepEqual([card.title, card.status, card.test], ["接通测试", "sent", true]);
      const fire = (await fires()).at(-1);
      assert.match(fire.body.text, /title: 接通测试\n\nThis is a test from the resident's settings page/);
      const { id, code } = sentJob(fire);
      assert.equal(id, card.id);
      const before = (await sent()).length;
      assert.equal((await report(id, "progress", code, { line: "收到了" })).status, 200);
      assert.equal((await report(id, "result", code, { status: "done", summary: "接通了" })).status, 200);
      await sleep(2000);
      assert.equal((await sent()).length, before, "nothing said on Telegram");
      const shown = (await tasks()).tasks[0];
      assert.deepEqual([shown.status, shown.summary], ["done", "接通了"]);
    });

    await step("/status says it is set up and how many went out", async () => {
      assert.match(await ask("/status"), /后台帮忙：开，默认交给 claude\.ai 的云端 Claude Code，轻活交给自己的线程；24 小时内派了 8 单，在干的 2 单/);
    });

    await step("an external thread opens on the web page with what was asked and what came back; it is not written to here", async () => {
      const thread = await (await web(`/web/thread?id=${first.id}`, KEY)).json();
      assert.deepEqual([thread.id, thread.title, thread.runs, thread.canSay, thread.files.length], [first.id, "修 README 的错字", "external", false, 0]);
      assert.deepEqual(thread.lines.slice(0, 2).map((line) => line.role), ["user", "result"]);
      assert.match(thread.lines[0].text, /^把 README 里/);
      assert.deepEqual([thread.lines[1].status, thread.lines[1].text, thread.lines[1].sessionUrl], ["done", "改好了，开了 PR。", "https://claude.ai/code/session_test_1"]);
      assert.ok(!JSON.stringify(thread).includes(first.code), "no code on the page");
      const said = await web("/web/thread/say", KEY, { id: first.id, text: "再改改" });
      assert.equal(said.status, 400);
      assert.match((await said.json()).error, /不在住户这里/);
      assert.equal((await web("/web/thread?id=t_0000000000", KEY)).status, 404);
      assert.equal((await web("/web/thread?id=nope", KEY)).status, 404);
      assert.equal((await fetch(`${WORKER}/web/thread?id=${first.id}`)).status, 401, "not without the web key");
      const listed = (await (await web("/web/threads", KEY)).json()).threads;
      assert.ok(listed.some((item) => item.id === first.id && item.tasks === 4), JSON.stringify(listed));
      assert.ok(!listed.some((item) => item.title === "接通测试"), "tests are not threads");
    });

    await step("without a trigger, jobs go to the resident's own threads and report back", async () => {
      await set({ CLOUD_TASK_URL: URL_OK, CLOUD_TASK_TOKEN: "" });
      const partial = await tasks();
      assert.deepEqual([partial.on, partial.configured, partial.mode], [true, false, "incomplete"]);
      assert.match(await ask("/status"), /后台帮忙：开了，自己的线程能干；claude.ai 的触发网址或 token 没填对/);

      await set({ CLOUD_TASK_URL: "", CLOUD_TASK_TOKEN: "" });
      const localState = await tasks();
      assert.deepEqual([localState.on, localState.configured, localState.mode], [true, true, "local"]);
      assert.match(await ask("/status"), /后台帮忙：开，交给自己的线程；24 小时内派了 8 单，在干的 2 单/);

      const firesBefore = (await fires()).length;
      const out = await ask("派活");
      const afterAsk = (await sent()).length;
      assert.equal((await fires()).length, firesBefore, "not sent to the external routine trigger");
      const id = out.match(/\bt_[0-9a-f]{10}\b/)?.[0];
      assert.ok(id, out);
      localThread = id;
      const reportOut = (await waitForSends(afterAsk, 1)).join("\n");
      assert.ok(reportOut.startsWith(`云端回来了：(Not from them: your cloud task ${id} "修 README 的错字" reported back: it is done.`), reportOut);
      assert.match(reportOut, /后台做好了：.*第 28 章/);
      assert.ok(!reportOut.includes("Session:"), "no external session link in a note about a thread here");
      const card = (await tasks()).tasks.find((t) => t.id === id);
      assert.deepEqual([card.status, card.sessionUrl, card.links, card.runs, card.thread], ["done", "", ["https://example.com/note"], "local", id]);
      assert.equal(card.progress, "正在看小本本：经济师进度");
      const worker = (await (await web("/web/usage", KEY)).json()).rows.filter((row) => row.kind === "worker");
      assert.ok(worker.length >= 2, "the thread's calls are in the usage timeline as its own kind");
    });

    await step("a thread here opens with its conversation; what she writes to it goes to it alone and makes a file she can download", async () => {
      const opened = await (await web(`/web/thread?id=${localThread}`, KEY)).json();
      assert.deepEqual([opened.runs, opened.canSay, opened.status], ["local", true, "done"]);
      assert.deepEqual(opened.lines.map((line) => line.role), ["user", "assistant", "result"]);
      assert.match(opened.lines[0].text, /^把 README 里/, "the brief shows as the job, without its header");
      assert.ok(opened.lines[1].steps.includes("正在看小本本：经济师进度"), JSON.stringify(opened.lines[1]));
      const today = (await tasks()).today;
      const before = (await sent()).length;
      const said = await web("/web/thread/say", KEY, { id: localThread, text: "标题再短一点" });
      assert.equal(said.status, 200, await said.clone().text());
      const until = Date.now() + 30000;
      let thread;
      while (Date.now() < until) {
        thread = await (await web(`/web/thread?id=${localThread}`, KEY)).json();
        if (thread.status === "done" && thread.files.length) break;
        await sleep(300);
      }
      assert.equal(thread.status, "done", JSON.stringify(thread));
      const mine = thread.lines.find((line) => line.role === "user" && line.direct);
      assert.equal(mine?.text, "标题再短一点");
      const [answer, result] = thread.lines.slice(-2);
      assert.equal(answer.role, "assistant");
      assert.match(answer.text, /改好了，在 \/page\.html：标题再短一点/);
      assert.ok(answer.steps.includes("正在写文件：/page.html"), JSON.stringify(answer));
      assert.deepEqual([result.role, result.status, result.text], ["result", "done", ""], "its last words are not shown twice");
      assert.deepEqual(thread.files.map((file) => file.path), ["/page.html"]);
      assert.equal(thread.files[0].size, new TextEncoder().encode("<h1>短标题</h1>").length);
      await sleep(1500);
      assert.equal((await sent()).length, before, "the resident says nothing about it on Telegram");
      assert.equal((await tasks()).today, today, "what she writes to a thread is not counted");
      const file = await web(`/web/thread/file?id=${localThread}&path=${encodeURIComponent("/page.html")}`, KEY);
      assert.equal(file.status, 200);
      assert.equal(file.headers.get("content-type"), "application/octet-stream");
      assert.equal(file.headers.get("content-disposition"), "attachment");
      assert.equal(file.headers.get("content-security-policy"), "sandbox");
      assert.equal(await file.text(), "<h1>短标题</h1>");
      assert.equal((await web(`/web/thread/file?id=${localThread}&path=/nope.txt`, KEY)).status, 404);
      assert.equal((await fetch(`${WORKER}/web/thread/file?id=${localThread}&path=/page.html`)).status, 401);
    });

    await step("the resident finds its threads again by their words and their files' names, reads a file, and searches the chat", async () => {
      const today = (await tasks()).today;
      const found = await ask("找找线程 page.html");
      assert.ok(found.includes(`"id":"${localThread}"`) && found.includes('"files":["/page.html"]'), found);
      assert.ok(!found.includes(`"id":"${first.id}"`), "a thread without those words is left out");
      assert.ok(found.includes('"where":"local"') && found.includes('"tasks":2'), found);
      assert.ok(!found.includes("接通测试"), "tests are not threads");
      // Words from the job of each: both threads, the newest first, and its id is all a follow-up needs.
      const both = await ask("找找线程 README recieve");
      assert.ok(both.indexOf(`"id":"${localThread}"`) >= 0 && both.indexOf(`"id":"${localThread}"`) < both.indexOf(`"id":"${first.id}"`), both);
      assert.match(await ask("找找线程 没有这种词"), /No thread has any of those words/);
      // By days: from yesterday to tomorrow is today wherever they are; long ago there was none.
      const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      const lately = await ask(`找找那几天的线程 ${day(-1)}..${day(1)}`);
      assert.ok(lately.includes(`"id":"${localThread}"`) && lately.includes(`"id":"${first.id}"`), lately);
      assert.match(await ask("找找那几天的线程 2020-01-01"), /No thread was active then/);

      const read = await ask(`看看线程文件 ${localThread} page.html`);
      assert.ok(read.includes('"path":"/page.html"') && read.includes("短标题"), read);
      assert.match(await ask(`看看线程文件 ${localThread} /nope.txt`), /No file \/nope\.txt in that thread/);
      assert.match(await ask(`看看线程文件 ${first.id} page.html`), /has no files here/);
      assert.match(await ask(`读完文件再派活 ${localThread}`), /has read a web page, a thread's file/);
      assert.equal((await tasks()).today, today, "nothing went out");

      // Her three questions about the tools, not this one, which has the words too.
      const searched = await ask("翻翻聊天 云端工具");
      assert.equal(searched.match(/"who":"them"/g)?.length, 3, searched);
      assert.ok(searched.includes('"text":"云端工具有哪些"'), searched);
      const id = searched.match(/"id":"([^"]+)"/)?.[1];
      assert.ok(id, searched);
      const around = await ask(`翻翻聊天前后 ${id}`);
      assert.ok(around.includes('"hit":true') && around.includes("有 cloud_task"), around);
      assert.match(await ask("翻翻聊天 没人说过这句话"), /Nothing said has those words/);
    });

    await step("make_file: the file goes to Telegram as a document and shows under the reply on the web page, to download", async () => {
      const said = await ask("做个文件");
      assert.ok(said.includes('"made":"计划.md"') && said.includes("Sent to Telegram"), said);
      const doc = (await log()).filter((e) => e.kind === "tg.sendDocument").at(-1);
      assert.deepEqual([doc?.body.chat_id, doc?.body.document?.file, doc?.body.document?.type], ["42", "计划.md", "text/markdown; charset=utf-8"]);
      const line = (await (await web("/web/messages", KEY)).json()).data.filter((l) => l.role === "assistant").at(-1);
      const content = "# 周末计划\n\n- 去公园\n- 早点睡";
      assert.deepEqual(line.files?.map((f) => [f.name, f.size]), [["计划.md", Buffer.byteLength(content)]]);
      const file = await web(`/web/file?key=${line.files[0].key}`, KEY);
      assert.equal(file.status, 200);
      assert.deepEqual(["content-type", "content-disposition", "content-security-policy"].map((h) => file.headers.get(h)), ["application/octet-stream", "attachment", "sandbox"]);
      assert.equal(await file.text(), content);
      assert.equal((await fetch(`${WORKER}/web/file?key=${line.files[0].key}`)).status, 401);
      assert.equal((await web(`/web/file?key=${"0".repeat(32)}`, KEY)).status, 404);
    });

    await step("a file made in a reply that then fails still shows under what was kept of that reply", async () => {
      const docs = async () => (await log()).filter((e) => e.kind === "tg.sendDocument").length;
      const sentBefore = await docs();
      await post("做个文件然后出错");
      const start = Date.now();
      while ((await docs()) === sentBefore) {
        assert.ok(Date.now() - start < 20000, "the file went to Telegram");
        await sleep(200);
      }
      let shown = [];
      while (shown.length < 2) {
        assert.ok(Date.now() - start < 30000, JSON.stringify((await (await web("/web/messages", KEY)).json()).data.slice(-3)));
        await sleep(300);
        shown = (await (await web("/web/messages", KEY)).json()).data.filter((line) => line.files?.length);
      }
      assert.deepEqual(shown.map((line) => line.files.map((f) => f.name)), [["计划.md"], ["计划.md"]]);

      // Taken back from the web page, the reply's file goes with it; the earlier one stays.
      const [kept, failed] = shown;
      const taken = await web("/web/take-back", KEY, { id: failed.id });
      assert.deepEqual([taken.status, await taken.json()], [200, { status: "removed" }]);
      assert.equal((await web(`/web/file?key=${failed.files[0].key}`, KEY)).status, 404);
      assert.equal((await web(`/web/file?key=${kept.files[0].key}`, KEY)).status, 200);
      const left = (await (await web("/web/messages", KEY)).json()).data.filter((line) => line.files?.length);
      assert.deepEqual(left.map((line) => line.id), [kept.id]);
    });

    await step("GitHub Actions with one token: the resident sets up a private repository, starts runs there, and lends a run its GitHub token and model", async () => {
      // A token that cannot write workflow files says so on the settings page.
      await set({ CLOUD_TASK_GITHUB_TOKEN: "no-workflow-token" });
      const refused = await web("/web/tasks/github", KEY, {});
      assert.equal(refused.status, 400);
      assert.match((await refused.json()).error, /写不了工作流文件/);
      const bad = await tasks();
      assert.deepEqual([bad.github.on, bad.github.repo], [true, ""]);
      assert.match(bad.github.problem, /写不了工作流文件/);

      await set({ CLOUD_TASK_GITHUB_TOKEN: "good-token" });
      const setUp = await web("/web/tasks/github", KEY, {});
      assert.equal(setUp.status, 200);
      const shown = await setUp.json();
      assert.equal(shown.mode, "linux");
      assert.deepEqual([shown.github.repo, shown.github.url, shown.github.problem], ["octo/resident-hands", "https://github.com/octo/resident-hands", ""]);
      assert.match(shown.github.tokenPage, /scopes=repo,workflow/);
      assert.ok(!JSON.stringify(shown).includes("good-token"), "the token is not sent back");
      const made = (await log()).filter((e) => e.kind === "github.create");
      assert.equal(made.length, 1);
      assert.equal(made[0].body.private, true);
      assert.deepEqual((await log()).filter((e) => e.kind === "github.file").map((e) => [e.path, e.branch]).at(-1), [".github/workflows/resident-hands.yml", "main"]);

      // A test run there: the job and the resident's address go in, and the card links to that run.
      const ghRes = await web("/web/tasks/test", KEY, { execution: "linux" });
      assert.equal(ghRes.status, 200);
      const ghCard = (await ghRes.json()).tasks[0];
      const dispatches = (await log()).filter((e) => e.kind === "github.dispatch");
      const ghDispatch = dispatches.at(-1);
      assert.equal(ghCard.runs, "linux");
      assert.equal(ghCard.sessionUrl, `https://github.com/octo/resident-hands/actions/runs/${dispatches.length}`);
      assert.equal(ghDispatch.repo, "octo/resident-hands");
      assert.deepEqual([ghDispatch.body.ref, ghDispatch.body.return_run_details, ghDispatch.body.inputs.resident], ["main", true, WORKER]);
      assert.match(ghDispatch.body.inputs.job, /title: 接通测试/);
      assert.ok(!/^model:/m.test(ghDispatch.body.inputs.job), "the resident picks the model, not the job");
      assert.equal((await log()).filter((e) => e.kind === "github.create").length, 1, "set up once");
      assert.match(await ask("/status"), /后台帮忙：开，交给自己的线程，要跑命令的交给 GitHub Actions/);

      // The run, as public/hands.mjs does it: the GitHub token, model steps through the resident, the result.
      const [, id, code] = ghDispatch.body.inputs.job.match(/^task: (t_[0-9a-f]{10})\ncode: ([0-9a-f]{32})\n/);
      const lend = (taskCode) => fetch(`${WORKER}/tasks/${id}/hands`, { method: "POST", headers: { "x-task-code": taskCode } });
      assert.equal((await lend("0".repeat(32))).status, 403);
      assert.deepEqual(await (await lend(code)).json(), { github_token: "good-token" });
      const tools = [
        { type: "function", function: { name: "bash", description: "Run a shell command.", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
        { type: "function", function: { name: "report_result", description: "Report the result.", parameters: { type: "object", properties: { status: { type: "string" }, summary: { type: "string" } }, required: ["status", "summary"] } } }
      ];
      const think = (messages, bearer = code) =>
        fetch(`${WORKER}/tasks/${id}/model/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body: JSON.stringify({ model: "resident", messages, tools })
        });
      const brief = [{ role: "system", content: "You are the resident's background hands for small jobs." }, { role: "user", content: "title: 接通测试\n\nsay hi" }];
      assert.equal((await think(brief, "0".repeat(32))).status, 403);
      // A step the model takes too long over is a 504 that says so, which the run tries once more.
      const slow = await think([brief[0], { role: "user", content: "title: 接通测试\n\n模型超时" }]);
      assert.deepEqual([slow.status, await slow.json()], [504, { error: { message: "the model did not answer within 5 minutes" } }]);
      const first = await (await think(brief)).json();
      assert.equal(first.object, "chat.completion");
      assert.equal(first.choices[0].finish_reason, "tool_calls");
      const [bash] = first.choices[0].message.tool_calls;
      assert.deepEqual([bash.function.name, JSON.parse(bash.function.arguments)], ["bash", { command: "echo hands-at-work" }]);
      const second = await (await think([...brief, first.choices[0].message, { role: "tool", tool_call_id: bash.id, content: "hands-at-work" }])).json();
      const [result] = second.choices[0].message.tool_calls;
      assert.equal(result.function.name, "report_result");
      assert.match(JSON.parse(result.function.arguments).summary, /hands-at-work/, "the command's output reached the model");
      const rows = (await (await web("/web/usage", KEY)).json()).rows;
      assert.ok(rows.slice(0, 2).every((row) => row.kind === "worker"), "counted as a thread's work");
      const report = (body) => fetch(`${WORKER}/tasks/${id}/result`, { method: "POST", headers: { "x-task-code": code, "content-type": "application/json" }, body: JSON.stringify(body) });
      const card = async () => (await tasks()).tasks.find((task) => task.id === id);
      assert.equal((await report({ status: "failed", summary: "克隆失败" })).status, 200);
      assert.equal((await card()).status, "failed");
      assert.equal((await think(brief)).status, 409, "a failed run cannot use the model any more");
      // GitHub's "Re-run" brings the same task: one that failed takes up its work again, on a fresh card.
      assert.deepEqual(await (await lend(code)).json(), { github_token: "good-token" });
      assert.deepEqual([(await card()).status, (await card()).summary], ["working", ""]);
      assert.equal((await think(brief)).status, 200);
      assert.equal((await report({ status: "done", summary: "接通了" })).status, 200);
      assert.equal((await card()).status, "done");
      assert.equal((await think(brief)).status, 409, "a finished task cannot use the model any more");
      // A re-run of one that is done is told so, and the card stays done.
      const done = await lend(code);
      assert.equal(done.status, 409);
      assert.deepEqual(await done.json(), { error: "this task is finished", finished: true });
      assert.equal((await card()).status, "done");

      await set({ CLOUD_TASK_URL: URL_OK, CLOUD_TASK_TOKEN: "good-token" });
      assert.equal((await tasks()).mode, "all", "claude.ai and GitHub Actions both set up");
      assert.match(await ask("/status"), /默认交给 claude.ai 的云端 Claude Code，轻活交给自己的线程，也能交给 GitHub Actions/);
      await set({ CLOUD_TASK_GITHUB_TOKEN: "" });
      assert.equal((await tasks()).mode, "external");
    });

    await step("ten a day at most, on the settings page and in the chat", async () => {
      for (let left = 10 - (await tasks()).today; left > 0; left -= 1) assert.equal((await web("/web/tasks/test", KEY, {})).status, 200);
      const over = await web("/web/tasks/test", KEY, {});
      assert.equal(over.status, 400);
      assert.match((await over.json()).error, /已经派了 10 单/);
      assert.match(await ask("派活"), /10 tasks have gone out in the last 24 hours/);
      assert.equal((await fires()).length, 10, "8 sent to the Claude trigger (1 ran locally, 1 on GitHub Actions), the wrong token and the busy trigger tried");
    });
  }

  // Roles on a worker of their own: the tasks stage uses all ten of the day.
  if (phase === "tasks-roles") {
    await set({ CLOUD_TASKS: "on" });
    await step("roles: three come with it; one she adds on the settings page, with its own model, does a thread's job with its template first", async () => {
      assert.deepEqual((await tasks()).roles.map((role) => [role.name, role.model]), [["coder", ""], ["reviewer", ""], ["researcher", ""]]);
      const bad = await web("/web/tasks/roles", KEY, { name: "测试", template: "x" });
      assert.equal(bad.status, 400);
      assert.match((await bad.json()).error, /小写英文字母开头/);
      assert.equal((await fetch(`${WORKER}/web/tasks/roles`, { method: "POST", body: "{}" })).status, 401);
      // The threads' own model is one that cannot run; the role's own (the fake one) does the work.
      await set({ CLOUD_TASK_MODEL: "@cf/no/such-model" });
      const saved = await web("/web/tasks/roles", KEY, { name: "tester", template: "只跑测试，写出哪些没过。", model: "fake" });
      assert.equal(saved.status, 200);
      assert.deepEqual((await saved.json()).roles.map((role) => role.name), ["coder", "reviewer", "researcher", "tester"]);
      assert.match(await ask("按角色派活 nobody"), /there is no role nobody\. Their roles: coder, reviewer, researcher, tester\./);
      const before = (await sent()).length;
      await post("按角色派活 tester");
      const [out, told] = await waitForSends(before, 2, 30000);
      const id = out.match(/\bt_[0-9a-f]{10}\b/)?.[0];
      assert.ok(id, out);
      assert.ok(told.startsWith(`云端回来了：(Not from them: your cloud task ${id} "按角色干" reported back: it is done.`), told);
      assert.equal((await tasks()).tasks.find((t) => t.id === id)?.status, "done");
      const thread = await (await web(`/web/thread?id=${id}`, KEY)).json();
      assert.equal(thread.lines[0].text, "只跑测试，写出哪些没过。\n\n看一下 README。");

      // What she writes in that thread, and a follow-up after it with no role named, still use the role's model.
      const until = async (done) => {
        const end = Date.now() + 30000;
        let seen;
        while (Date.now() < end) {
          seen = await (await web(`/web/thread?id=${id}`, KEY)).json();
          if (done(seen)) return seen;
          await sleep(300);
        }
        assert.fail(JSON.stringify(seen));
      };
      assert.equal((await web("/web/thread/say", KEY, { id, text: "再看看" })).status, 200);
      const written = await until((seen) => seen.tasks.length === 2 && seen.status !== "sent" && seen.status !== "working");
      assert.equal(written.status, "done", "the role's model did it, not the threads' one that cannot run");
      const later = (await sent()).length;
      await post(`角色线程接着做 ${id}`);
      const [, back] = await waitForSends(later, 2, 30000);
      assert.match(back, /reported back: it is done/);
      const after = await until((seen) => seen.tasks.length === 3 && seen.status === "done");
      assert.equal(after.lines.filter((line) => line.role === "user").at(-1).text, "只跑测试，写出哪些没过。\n\n再看一遍。", "the role's template too");
      await set({ CLOUD_TASK_MODEL: "" });
      const removed = await (await web("/web/tasks/roles/remove", KEY, { name: "tester" })).json();
      assert.deepEqual(removed.roles.map((role) => role.name), ["coder", "reviewer", "researcher"]);
    });

  }

  if (phase === "tasks-quiet") {
    await set({ CLOUD_TASKS: "on", CLOUD_TASK_URL: URL_OK, CLOUD_TASK_TOKEN: "good-token" });
    await step("a task that never reports: after the quiet time she is told, with the link, and a late result still comes through", async () => {
      await ask("派活");
      const { id, code } = sentJob((await fires())[0]);
      const before = (await sent()).length;
      const out = (await waitForSends(before, 1, 30000)).join("\n");
      assert.ok(out.startsWith(`云端回来了：(Not from them: your cloud task ${id} "修 README 的错字" has not reported back after 1 minute.`), out);
      assert.ok(out.includes("https://claude.ai/code/session_test_1"));
      assert.equal((await tasks()).tasks[0].status, "quiet");
      assert.equal((await report(id, "progress", code, { line: "还在改" })).status, 200);
      assert.equal((await tasks()).tasks[0].status, "working");
      const later = (await sent()).length;
      assert.equal((await report(id, "result", code, { status: "needs_you", summary: "要你选一个名字。" })).status, 200);
      assert.match((await waitForSends(later, 1)).join("\n"), /it needs them to decide something/);
      assert.equal((await tasks()).tasks[0].status, "needs_you");
    });

    await step("one that keeps sending progress is not called quiet", async () => {
      await ask("派活");
      const { id, code } = sentJob((await fires()).at(-1));
      assert.equal((await report(id, "progress", code, { line: "开始了" })).status, 200);
      const before = (await sent()).length;
      await sleep(8000);
      assert.equal((await sent()).length, before);
      assert.equal((await tasks()).tasks.find((t) => t.id === id).status, "working");
    });
  }
}

if (phase === "sites") {
  await fetch(`${MOCK}/__reset`);
  const KEY = "test-web-key";
  const ask = async (text, count = 1) => {
    const before = (await sent()).length;
    await post(text);
    return (await waitForSends(before, count)).join("\n");
  };
  const add = (site, key) => web("/web/sites", KEY, { site, key });

  await step("a site's key is saved on the settings page, shown without its values, and the model is told the site", async () => {
    assert.doesNotMatch(await ask("读网页怎么说"), /key for/);
    const saved = await add("https://Gated.example/a/", "CF-Access-Client-Id: id-1.access\nCF-Access-Client-Secret: secret-1");
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.deepEqual((await saved.json()).sites, [{ host: "gated.example", names: ["CF-Access-Client-Id", "CF-Access-Client-Secret"] }]);
    const listed = await (await web("/web/sites", KEY)).text();
    assert.ok(listed.includes("gated.example") && !listed.includes("secret-1") && !listed.includes("id-1.access"), listed);
    assert.equal((await fetch(`${WORKER}/web/sites`)).status, 401, "not without the web key");
    const told = await ask("读网页怎么说");
    assert.match(told, /They gave you a key for gated\.example, so the private pages there open too\./);
    assert.ok(!told.includes("secret-1"));
  });

  await step("what cannot be a site or a key is refused", async () => {
    for (const [site, key, said] of [
      ["http://plain.example", "t", /只给 https/],
      ["localhost", "t", /不能读/],
      ["127.0.0.1:9999", "t", /不能读/],
      ["ok.example", "", /要填钥匙/],
      ["ok.example", "Host: other.example", /Host 不能/],
      ["ok.example", "a: 1\nwords", /名字: 值/]
    ]) {
      const response = await add(site, key);
      assert.equal(response.status, 400, site);
      assert.match((await response.json()).error, said, `${site} ${key}`);
    }
  });

  await step("/status lists the sites with a key; one is taken off on the settings page", async () => {
    assert.ok(!(await add("raw.githubusercontent.com", "github_pat_test")).error);
    assert.match(await ask("/status"), /带钥匙的网站：gated\.example、raw\.githubusercontent\.com/);
    const removed = await web("/web/sites/remove", KEY, { host: "gated.example" });
    assert.deepEqual((await removed.json()).sites, [{ host: "raw.githubusercontent.com", names: ["Authorization"] }]);
    assert.match(await ask("读网页怎么说"), /key for raw\.githubusercontent\.com,/);
  });
}

/** Aelios' records of the resident's own turns (check-ins, heartbeats, alarms), waiting up to `ms` for `count`. */
async function checkinsInAelios(count, ms = 5000) {
  const start = Date.now();
  for (;;) {
    const found = (await log()).filter((e) => e.kind === "aelios.ingest" && e.body.source === "aelios-resident:checkin");
    if (found.length >= count || Date.now() - start > ms) return found;
    await sleep(100);
  }
}

/** The alarms on the settings page, polled until `ok` says yes or `ms` passes. */
async function alarmsUntil(ok, ms = 10000) {
  const start = Date.now();
  for (;;) {
    const list = await (await web("/web/alarms", "test-web-key")).json();
    if (ok(list) || Date.now() - start > ms) return list;
    await sleep(150);
  }
}

if (phase === "heartbeat") {
  const KEY = "test-web-key";
  const letters = async () => (await log()).filter((e) => e.kind === "aelios.ingest" && e.body.source === "aelios-resident:letter");
  await fetch(`${MOCK}/__reset`);
  await step("below the letter threshold, even with foldable older chat: a heartbeat asks and reaches out", async () => {
    await fillChat();
    const mark = (await sent()).length;
    await post("今天好累。");
    await waitForSends(mark, 2);
    assert.deepEqual(await waitForSends(mark + 2, 2), ["在忙吗？", "想你了。"]);
    const ingest = await checkinsInAelios(1);
    assert.equal(ingest.length, 1);
    assert.deepEqual(ingest[0].body.messages, [{ role: "assistant", content: "在忙吗？\n\n想你了。" }]);
    assert.equal((await letters()).length, 0, "below the configured threshold, so no letter");
  });
  await step("she writes back: the quiet time is over, and the next one counts from 1 again", async () => {
    const mark = (await sent()).length;
    await post("刚洗完澡");
    const out = await waitForSends(mark, 4);
    assert.match(out[0], /刚洗完澡/);
    assert.deepEqual(out.slice(2), ["在忙吗？", "想你了。"], "the first heartbeat again, not the third of the old count");
  });
  await step("up to three heartbeats in one quiet time (the second passed with SKIP), then nothing more", async () => {
    const mark = (await sent()).length;
    assert.deepEqual(await waitForSends(mark, 1), ["还在忙吗？"]);
    const before = (await sent()).length;
    await sleep(9000);
    assert.deepEqual((await sent()).slice(before), []);
    assert.deepEqual((await checkinsInAelios(3)).map((e) => e.body.messages[0].content), ["在忙吗？\n\n想你了。", "在忙吗？\n\n想你了。", "还在忙吗？"]);
    assert.equal((await letters()).length, 0);
  });
  await step("the web page shows what it said, not the notes that asked it", async () => {
    const { data } = await (await web("/web/messages", KEY)).json();
    const said = data.find((line) => line.text === "还在忙吗？");
    assert.equal(said?.via, "checkin", JSON.stringify(data));
    assert.ok(!data.some((line) => /heartbeat|Not from them|SKIP/.test(line.text)), JSON.stringify(data));
  });
  await step("/status says how often it asks", async () => {
    const before = (await sent()).length;
    await post("/status");
    const [out] = await waitForSends(before, 1);
    assert.match(out, /心跳：开，没动静 1 分钟、尚不需要写信时问它要不要找你，一段沉默最多 3 次/);
    assert.match(out, /闹钟：关/);
  });
  await step("quiet hours on the settings page: unreadable ones are refused, and in them no heartbeat is asked", async () => {
    let response = await web("/web/config", KEY, { key: "QUIET_HOURS", text: "晚上" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /00:00-08:00/);
    // From this hour (TIME_ZONE in wrangler.test.jsonc) to two hours on, so the whole step runs inside them.
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    const clock = (h) => `${String(h % 24).padStart(2, "0")}:00`;
    response = await web("/web/config", KEY, { key: "QUIET_HOURS", text: `${clock(hour)}-${clock(hour + 2)}` });
    assert.equal(response.status, 200);
    const mark = (await sent()).length;
    await post("我睡了，晚安");
    await waitForSends(mark, 2);
    const before = (await sent()).length;
    await sleep(9000);
    assert.deepEqual((await sent()).slice(before), [], "quiet hours: not asked");
    assert.equal((await checkinsInAelios(4, 0)).length, 3);
    const statusMark = (await sent()).length;
    await post("/status");
    const [out] = await waitForSends(statusMark, 1);
    assert.match(out, new RegExp(`一段沉默最多 3 次；夜里 ${hour % 24}:00 到 ${(hour + 2) % 24}:00（Asia/Shanghai）不问`));
    assert.equal((await web("/web/config", KEY, { key: "QUIET_HOURS", text: "" })).status, 200);
  });
  await step("the count is set on the settings page: 0 never asks, more than 10 is refused", async () => {
    let response = await web("/web/config", KEY, { key: "HEARTBEAT", text: "11" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /0 到 10/);
    response = await web("/web/config", KEY, { key: "HEARTBEAT", text: "0" });
    assert.equal(response.status, 200);
    const mark = (await sent()).length;
    await post("我去睡了");
    await waitForSends(mark, 2);
    const before = (await sent()).length;
    await sleep(9000);
    assert.deepEqual((await sent()).slice(before), []);
    assert.equal((await checkinsInAelios(4, 0)).length, 3);
  });
  await step("with alarms on, a heartbeat may come back later: too soon is refused, an hour ahead is set, and rings", async () => {
    // One heartbeat, so the one alarm it sets is the only one.
    assert.equal((await web("/web/config", KEY, { key: "HEARTBEAT", text: "1" })).status, 200);
    assert.equal((await web("/web/config", KEY, { key: "ALARMS", text: "on" })).status, 200);
    const mark = (await sent()).length;
    await post("我先忙会儿");
    await waitForSends(mark, 2);
    const list = await alarmsUntil((l) => l.alarms.length > 0);
    assert.deepEqual(list.alarms.map((a) => [a.note, a.when]), [["晚点再问问她", "一次"]], "only the one an hour ahead");
    // The heartbeat itself answered SKIP: the next thing she gets is the alarm.
    assert.deepEqual(await waitForSends(mark + 2, 1), ["闹钟响了：晚点再问问她"]);
    assert.equal((await alarmsUntil((l) => l.alarms.length === 0)).alarms.length, 0, "a one-time alarm is gone after it rings");
  });
}

if (phase === "alarms") {
  const KEY = "test-web-key";
  await fetch(`${MOCK}/__reset`);
  const say = async (text, count = 1) => {
    const before = (await sent()).length;
    await post(text);
    return waitForSends(before, count);
  };
  await step("off by default: no alarm tools", async () => {
    assert.deepEqual(await say("闹钟工具有哪些"), ["没有闹钟工具。"]);
    const list = await (await web("/web/alarms", KEY)).json();
    assert.deepEqual(list, { on: false, limit: 10, alarms: [] });
  });
  await step("turned on on the settings page, it gets set_alarm, list_alarms and cancel_alarm", async () => {
    assert.equal((await web("/web/config", KEY, { key: "ALARMS", text: "on" })).status, 200);
    assert.deepEqual(await say("闹钟工具有哪些"), ["set_alarm|list_alarms|cancel_alarm"]);
  });
  await step("an alarm she asks for rings once, as its own turn, and is gone", async () => {
    const before = (await sent()).length;
    const [set] = await say("等会儿提醒我喝水");
    assert.match(set, /^我查到了：.*"note":"提醒她喝水".*"status":"Set\./);
    assert.deepEqual(await waitForSends(before + 1, 1), ["闹钟响了：提醒她喝水"]);
    const ingest = await checkinsInAelios(1);
    assert.deepEqual(ingest.map((e) => e.body.messages[0].content), ["闹钟响了：提醒她喝水"]);
    assert.equal((await alarmsUntil((l) => l.alarms.length === 0)).alarms.length, 0);
    const { data } = await (await web("/web/messages", KEY)).json();
    assert.ok(!data.some((line) => /an alarm you set/.test(line.text)), "the ring's note is not shown as hers");
  });
  await step("a repeating one is listed in words, and keeps its wall-clock time when the time zone changes", async () => {
    await say("每天早上叫我");
    let list = await (await web("/web/alarms", KEY)).json();
    assert.equal(list.alarms.length, 1);
    assert.equal(list.alarms[0].note, "叫她起床");
    assert.equal(list.alarms[0].when, "每天 09:00");
    assert.match(list.alarms[0].next, / 09:00$/);
    assert.equal((await web("/web/config", KEY, { key: "TIME_ZONE", text: "America/New_York" })).status, 200);
    list = await (await web("/web/alarms", KEY)).json();
    assert.match(list.alarms[0].next, / 09:00$/, "moved to 09:00 in the new time zone");
    await web("/web/config", KEY, { key: "TIME_ZONE", text: "" });
  });
  await step("at most 10 alarms", async () => {
    await say("定六个闹钟");
    const [out] = await say("定六个闹钟");
    assert.match(out, /already have 10 alarms/);
    assert.equal((await (await web("/web/alarms", KEY)).json()).alarms.length, 10);
  });
  await step("listed and cancelled from the chat", async () => {
    const [list] = await say("看看闹钟");
    assert.match(list, /叫她起床/);
    assert.equal((list.match(/"id":"a_[0-9a-f]{8}"/g) ?? []).length, 10);
    const [out] = await say("取消那个闹钟");
    assert.match(out, /"cancelled":"a_[0-9a-f]{8}"/);
    assert.equal((await (await web("/web/alarms", KEY)).json()).alarms.length, 9);
  });
  await step("/status counts them; the settings page takes them away", async () => {
    let [status] = await say("/status");
    assert.match(status, /闹钟：开，它定了 9 个/);
    for (const alarm of (await (await web("/web/alarms", KEY)).json()).alarms) {
      const after = await (await web("/web/alarms/remove", KEY, { id: alarm.id })).json();
      assert.ok(!after.alarms.some((a) => a.id === alarm.id));
    }
    [status] = await say("/status");
    assert.match(status, /闹钟：开，它定了 0 个/);
  });
  await step("turned off, the tools go and a ring passes without a word", async () => {
    await say("等会儿提醒我喝水");
    assert.equal((await (await web("/web/alarms", KEY)).json()).alarms.length, 1);
    await web("/web/config", KEY, { key: "ALARMS", text: "off" });
    const before = (await sent()).length;
    assert.equal((await alarmsUntil((l) => l.alarms.length === 0)).alarms.length, 0);
    await sleep(1500);
    assert.deepEqual((await sent()).slice(before), []);
    assert.deepEqual(await say("闹钟工具有哪些"), ["没有闹钟工具。"]);
  });
}

if (phase === "wecom") {
  await fetch(`${MOCK}/__reset`);
  const KEY = "test-web-key";
  const CORP = "wwtest0001";
  const AGENT = "1000002";
  const TOKEN = "wecomTestToken42";
  const AES = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
  const RELAY_KEY = "relay-key-for-tests-0123456789abcdef";
  const set = async (settings) => {
    for (const [key, text] of Object.entries(settings)) {
      const response = await web("/web/config", KEY, { key, text });
      assert.equal(response.status, 200, `${key}: ${await response.clone().text()}`);
    }
  };
  const state = async () => (await (await web("/web/config", KEY)).json()).wecom;
  const ofKind = async (kind) => (await log()).filter((e) => e.kind === kind);
  const wecomSent = async () => ofKind("wecom.send");
  const texts = async () => (await wecomSent()).filter((e) => e.body.msgtype === "text").map((e) => e.body.text.content);
  const waitFor = async (read, before, count, timeoutMs = 20000) => {
    const start = Date.now();
    for (;;) {
      const all = await read();
      if (all.length >= before + count) return all.slice(before);
      if (Date.now() - start > timeoutMs) throw new Error(`timed out: wanted ${count} more, have ${all.length - before}: ${JSON.stringify(all.slice(before))}`);
      await sleep(200);
    }
  };
  // What WeCom does: AES-256-CBC with the EncodingAESKey, 16 random bytes, the length, the XML, the CorpID, padded to 32.
  const encrypt = (text, corp = CORP) => {
    const key = Buffer.from(`${AES}=`, "base64");
    const message = Buffer.from(text);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(message.length);
    let plain = Buffer.concat([crypto.randomBytes(16), length, message, Buffer.from(corp)]);
    const pad = 32 - (plain.length % 32);
    plain = Buffer.concat([plain, Buffer.alloc(pad, pad)]);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(plain), cipher.final()]).toString("base64");
  };
  const sign = (timestamp, nonce, encrypted, token = TOKEN) =>
    crypto.createHash("sha1").update([token, timestamp, nonce, encrypted].sort().join("")).digest("hex");
  const signed = (encrypted, { token, timestamp = Math.floor(Date.now() / 1000) } = {}) => {
    const nonce = `n${Math.floor(Math.random() * 1e9)}`;
    return `msg_signature=${sign(String(timestamp), nonce, encrypted, token)}&timestamp=${timestamp}&nonce=${nonce}`;
  };
  let msgId = 7000000000000000;
  const push = async (fields, { user = "HerUser", token, timestamp, corp } = {}) => {
    const all = { ToUserName: CORP, FromUserName: user, CreateTime: String(Math.floor(Date.now() / 1000)), AgentID: AGENT, MsgId: String(msgId++), ...fields };
    const xml = `<xml>${Object.entries(all).map(([k, v]) => `<${k}><![CDATA[${v}]]></${k}>`).join("")}</xml>`;
    const encrypted = encrypt(xml, corp);
    const response = await fetch(`${WORKER}/messengers/wecom/webhook?${signed(encrypted, { token, timestamp })}`, {
      method: "POST",
      headers: { "content-type": "text/xml" },
      body: `<xml><ToUserName><![CDATA[${CORP}]]></ToUserName><Encrypt><![CDATA[${encrypted}]]></Encrypt><AgentID><![CDATA[${AGENT}]]></AgentID></xml>`
    });
    return { status: response.status, body: await response.text(), fields: all };
  };
  const verify = async (echo, options) => {
    const encrypted = encrypt(echo);
    const response = await fetch(`${WORKER}/messengers/wecom/webhook?${signed(encrypted, options)}&echostr=${encodeURIComponent(encrypted)}`);
    return { status: response.status, body: await response.text() };
  };

  await step("off until it is set up: the address answers nothing, and the settings page says it is not connected", async () => {
    assert.equal((await state()).gap, "off");
    assert.equal((await verify("123")).status, 404);
    assert.equal((await push({ MsgType: "text", Content: "hi" })).status, 404);
    assert.equal((await ofKind("wecom.send")).length, 0);
  });

  await step("bad values are not saved", async () => {
    for (const [key, text, error] of [
      ["WECOM_CORP_ID", "corp", /ww 开头/],
      ["WECOM_AGENT_ID", "12a", /数字/],
      ["WECOM_AES_KEY", "short", /43 位/],
      ["WECOM_RELAY_KEY", "short", /32 位/],
      ["WECOM_RELAY_URL", "ftp://x", /https/]
    ]) {
      const response = await web("/web/config", KEY, { key, text });
      assert.equal(response.status, 400, key);
      assert.match((await response.json()).error, error);
    }
  });

  await step("with the CorpID, Token and EncodingAESKey saved, WeCom's check of the address passes (before the relay works)", async () => {
    await set({ WECOM_CORP_ID: CORP, WECOM_TOKEN: TOKEN, WECOM_AES_KEY: AES });
    assert.equal((await state()).gap, "WECOM_AGENT_ID");
    const ok = await verify("1616140317555161061");
    assert.deepEqual(ok, { status: 200, body: "1616140317555161061" });
    assert.equal((await verify("x", { token: "wrongToken" })).status, 403, "a wrong signature");
    assert.equal((await verify("x", { timestamp: Math.floor(Date.now() / 1000) - 2 * 3600 })).status, 403, "an old one");
    const config = JSON.stringify(await (await web("/web/config", KEY)).json());
    assert.ok(!config.includes(TOKEN) && !config.includes(AES), "the secrets are not sent back");
  });

  await step("someone not let in gets no answer, and the settings page shows who it was", async () => {
    assert.equal((await push({ MsgType: "text", Content: "你好" })).status, 200);
    await sleep(1500);
    assert.equal((await wecomSent()).length, 0);
    assert.equal((await state()).refused?.user, "HerUser");
  });

  await step("a push that is not signed with her Token, or not for her enterprise, is refused", async () => {
    assert.equal((await push({ MsgType: "text", Content: "x" }, { token: "otherToken" })).status, 403);
    assert.equal((await push({ MsgType: "text", Content: "x" }, { corp: "wwsomeoneelse" })).status, 403);
  });

  await step("filled in, the relay is asked what it can do and she is let in (her UserID in any case)", async () => {
    await set({ WECOM_AGENT_ID: AGENT, WECOM_SECRET: "wecom-secret", WECOM_RELAY_URL: "http://127.0.0.1:9999/wecom-relay", WECOM_RELAY_KEY: RELAY_KEY, WECOM_ALLOWED: "heruser" });
    const now = await state();
    assert.equal(now.gap, null);
    assert.deepEqual(now.relay, { amr: true, mp3: true, gif: true, png: true });
    assert.deepEqual(now.allowed, ["heruser"]);
    assert.equal(now.refused, null, "no longer shut out");
  });

  let first;
  await step("a message gets two text messages back, with the time stamp the model saw, sent through the relay", async () => {
    const before = (await wecomSent()).length;
    first = await push({ MsgType: "text", Content: "你好" });
    assert.deepEqual([first.status, first.body], [200, ""]);
    const out = await waitFor(wecomSent, before, 2);
    assert.match(out[0].body.text.content, /^收到：\[\d\d-\d\d 周. \d\d:\d\d\] 你好$/);
    assert.equal(out[1].body.text.content, "这是第二个气泡。");
    assert.deepEqual([out[0].body.touser, out[0].body.agentid, out[0].body.msgtype], ["HerUser", 1000002, "text"]);
    assert.equal((await ofKind("wecom.gettoken")).length, 1, "one access token, kept");
  });

  await step("the same push again (WeCom retries when slow) is not answered twice", async () => {
    const before = (await wecomSent()).length;
    await push({ MsgType: "text", Content: "你好", MsgId: first.fields.MsgId });
    await sleep(2500);
    assert.equal((await wecomSent()).length, before);
  });

  await step("the web page shows her WeCom message as from WeCom", async () => {
    const lines = (await (await web("/web/messages", KEY)).json()).data;
    const mine = lines.findLast((line) => line.role === "user");
    assert.equal(mine.via, "wecom");
  });

  await step("an expired access token is replaced and the message still goes out", async () => {
    await fetch(`${MOCK}/__faults`, { method: "POST", body: JSON.stringify({ wecomExpire: true }) });
    const before = (await wecomSent()).length;
    await push({ MsgType: "text", Content: "过期了吗" });
    const out = await waitFor(wecomSent, before, 2);
    assert.match(out[0].body.text.content, /过期了吗/);
    assert.equal((await ofKind("wecom.gettoken")).length, 2);
  });

  await step("a long reply is cut into messages of at most 2048 bytes, nothing lost", async () => {
    const long = "长".repeat(1500);
    const before = (await texts()).length;
    await push({ MsgType: "text", Content: long });
    const out = await waitFor(texts, before, 4);
    const reply = out.slice(0, -1);
    assert.ok(reply.length >= 3, `${reply.length} pieces`);
    assert.ok(reply.every((text) => Buffer.byteLength(text) <= 2048));
    assert.equal(reply.join("").replace(/^收到：\[[^\]]+\] /, ""), long);
  });

  await step("/status is answered without the model, with a line for WeCom", async () => {
    const before = (await texts()).length;
    await push({ MsgType: "text", Content: "/status" });
    const [status] = await waitFor(texts, before, 1);
    assert.match(status, /企业微信：放行 heruser；转发机能转语音/);
  });

  await step("a picture she sends comes down through the relay and reaches the model as a picture (PNG, as it is)", async () => {
    const before = (await texts()).length;
    await push({ MsgType: "image", MediaId: "pic-1", PicUrl: "http://example.com/x.png" });
    await sleep(500);
    await push({ MsgType: "text", Content: "看图" });
    const out = await waitFor(texts, before, 1);
    assert.match(out.join("\n"), /看到 1 张图/);
    assert.ok((await ofKind("wecom.get")).some((e) => e.id === "pic-1"));
  });

  await step("stickers are off on WeCom unless turned on: the mark is only taken out, nothing is uploaded", async () => {
    const body = zip([
      { name: "pack.json", data: JSON.stringify({ format: "resident-stickers/1", name: "Test", stickers: [{ id: "wave", file: "wave.gif", emoji: "👋", when: "Say hi.", telegram: "wave.webm" }] }) },
      { name: "wave.gif", data: GIF },
      { name: "wave.webm", data: WEBM }
    ]);
    const imported = await fetch(`${WORKER}/web/stickers/import?name=test.zip`, { method: "POST", headers: { "x-web-key": KEY, "content-type": "application/zip" }, body });
    assert.equal(imported.status, 200, await imported.clone().text());
    const uploads = (await ofKind("wecom.upload")).length;
    const said = (await texts()).length;
    await push({ MsgType: "text", Content: "发表情" });
    assert.deepEqual(await waitFor(texts, said, 2), ["嗨～", "再说一句。"]);
    await sleep(1000);
    assert.equal((await ofKind("wecom.upload")).length, uploads, "nothing uploaded");
  });

  await step("turned on, a sticker goes out after its paragraph, as a still PNG uploaded to WeCom", async () => {
    await set({ WECOM_STICKERS: "on" });
    const converts = (await ofKind("wecom.convert")).length;
    const before = (await wecomSent()).length;
    await push({ MsgType: "text", Content: "发表情" });
    const out = await waitFor(wecomSent, before, 1);
    const last = out.at(-1);
    await sleep(1500);
    const all = (await wecomSent()).slice(before);
    const image = all.find((e) => e.body.msgtype === "image");
    assert.ok(image, JSON.stringify(all.map((e) => e.body.msgtype)) + JSON.stringify(last.body));
    const upload = (await ofKind("wecom.upload")).at(-1);
    assert.deepEqual([upload.type, upload.media.type, upload.media.file, upload.filelength], ["image", "image/png", "sticker.png", true]);
    assert.equal(upload.media.head.slice(1, 4), "PNG", "the GIF made a PNG");
    const colour = await web("/web/config", KEY, { key: "WECOM_STICKER_BACKGROUND", text: "red" });
    assert.equal(colour.status, 400);
    assert.match((await colour.json()).error, /#EDEDED/);
    assert.equal((await ofKind("wecom.convert")).length, converts, "by the resident, not the relay");
    assert.equal(image.body.image.media_id.startsWith("wecom-media-"), true);
    assert.deepEqual(all.map((e) => e.body.msgtype === "text" ? e.body.text.content : e.body.msgtype), ["嗨～", "image", "再说一句。"], "right after its paragraph");
  });

  await step("with a voice set up, her voice message (AMR) is made MP3 by the relay, heard, and answered with a WeCom voice message (AMR)", async () => {
    await set({ VOICE_BASE_URL: "http://127.0.0.1:9999/voice", VOICE_API_KEY: "test-voice-key", VOICE_PROVIDER: "elevenlabs", VOICE_ID: "voice-123" });
    const before = (await wecomSent()).length;
    await push({ MsgType: "voice", MediaId: "voice-1", Format: "amr" });
    const out = await waitFor(wecomSent, before, 1);
    await sleep(1500);
    const all = (await wecomSent()).slice(before);
    assert.deepEqual(all.map((e) => e.body.msgtype), ["voice"], "the reply is the voice message only: " + JSON.stringify(out.map((e) => e.body)));
    const converts = await ofKind("wecom.convert");
    assert.deepEqual(converts.slice(-2).map((e) => [e.to, e.head.slice(0, 5)]), [["mp3", "#!AMR"], ["amr", "ID3\u0004\u0000"]]);
    const stt = (await ofKind("voice")).find((e) => e.endpoint === "v1/speech-to-text" && e.body?.file?.type === "audio/mpeg");
    assert.ok(stt, "heard as MP3");
    const tts = (await ofKind("voice")).at(-1);
    assert.match(tts.body.text, /企微里说的话/);
    const upload = (await ofKind("wecom.upload")).at(-1);
    assert.deepEqual([upload.type, upload.media.type, upload.media.file, upload.media.head.slice(0, 5)], ["voice", "audio/amr", "voice.amr", "#!AMR"]);
  });

  await step("send_voice sends to WeCom when that is where she last wrote", async () => {
    const before = (await wecomSent()).length;
    await push({ MsgType: "text", Content: "发条语音" });
    const out = await waitFor(wecomSent, before, 1);
    await sleep(1500);
    assert.deepEqual((await wecomSent()).slice(before).map((e) => e.body.msgtype), ["voice"], JSON.stringify(out.map((e) => e.body)));
  });

  await step("a relay installed without --media: voice replies go out as text, the settings page says why, a GIF sticker still goes", async () => {
    await fetch(`${MOCK}/__faults`, { method: "POST", body: JSON.stringify({ wecomMedia: false }) });
    // Saving a WeCom setting asks the relay again.
    await set({ WECOM_RELAY_URL: "http://127.0.0.1:9999/wecom-relay/" });
    assert.equal((await state()).relay.amr, false);
    const before = (await wecomSent()).length;
    await push({ MsgType: "voice", MediaId: "voice-2", Format: "amr" });
    const out = await waitFor(wecomSent, before, 2);
    assert.deepEqual(out.map((e) => e.body.msgtype), ["text", "text"]);
    assert.match(out[0].body.text.content, /\[voice, could not be heard\]/);
    // A GIF sticker needs no relay to become a still picture.
    const uploads = (await ofKind("wecom.upload")).length;
    const said = (await wecomSent()).length;
    await push({ MsgType: "text", Content: "发表情" });
    await waitFor(wecomSent, said, 1);
    await sleep(1500);
    const sticker = (await ofKind("wecom.upload")).slice(uploads);
    assert.deepEqual(sticker.map((e) => [e.type, e.media.type]), [["image", "image/png"]]);
    await fetch(`${MOCK}/__faults`, { method: "POST", body: JSON.stringify({ wecomMedia: true }) });
    await set({ VOICE_PROVIDER: "off" });
  });

  await step("a wrong relay key: nothing goes out, and the settings page and /status say why", async () => {
    await set({ WECOM_RELAY_KEY: "x".repeat(40) });
    await push({ MsgType: "text", Content: "钥匙错了" });
    await sleep(3000);
    const now = await state();
    assert.equal(now.relay, null);
    assert.match(now.error?.reason ?? "", /钥匙/);
    assert.ok((await ofKind("wecom.refused")).length > 0);
    await set({ WECOM_RELAY_KEY: RELAY_KEY });
    assert.equal((await state()).error, null, "cleared once the setting changes");
  });

  await step("a cloud task's result, outside any turn, goes to WeCom, where she last wrote", async () => {
    await set({ CLOUD_TASKS: "on", CLOUD_TASK_URL: "https://api.anthropic.com/v1/claude_code/routines/trig_testtask01/fire", CLOUD_TASK_TOKEN: "good-token" });
    const before = (await texts()).length;
    await push({ MsgType: "text", Content: "派活" });
    await waitFor(texts, before, 1);
    const fire = (await ofKind("routine.fire")).at(-1);
    const [, id, code] = fire.body.text.match(/^task: (t_[0-9a-f]{10})\ncode: ([0-9a-f]{32})\n/) ?? [];
    assert.ok(id && code);
    await sleep(1500);
    const after = (await texts()).length;
    const done = await fetch(`${WORKER}/tasks/${id}/result`, { method: "POST", headers: { "content-type": "application/json", "x-task-code": code }, body: JSON.stringify({ status: "done", summary: "改好了。" }) });
    assert.equal(done.status, 200);
    const out = await waitFor(texts, after, 1);
    assert.match(out.join("\n"), /云端回来了/);
  });

  await step("Telegram still works next to it, and once she writes there, what goes out of turn goes there", async () => {
    const before = (await sent()).length;
    await post("TG 也在");
    const out = await waitForSends(before, 2);
    assert.match(out[0], /TG 也在/);
    await post("派活");
    await waitForSends(before + 2, 1);
    const fire = (await ofKind("routine.fire")).at(-1);
    const [, id, code] = fire.body.text.match(/^task: (t_[0-9a-f]{10})\ncode: ([0-9a-f]{32})\n/) ?? [];
    await sleep(1500);
    const tg = (await sent()).length;
    const wecom = (await texts()).length;
    await fetch(`${WORKER}/tasks/${id}/result`, { method: "POST", headers: { "content-type": "application/json", "x-task-code": code }, body: JSON.stringify({ status: "done", summary: "又改好了。" }) });
    assert.match((await waitForSends(tg, 1)).join("\n"), /云端回来了/);
    assert.equal((await texts()).length, wecom, "not to WeCom");
  });
}

if (phase === "telegram") {
  await fetch(`${MOCK}/__reset`);
  const KEY = "test-web-key";
  const TOKEN = `654321:${"A".repeat(35)}`;
  const HOOK = `${WORKER}/messengers/telegram/webhook`;
  const config = async () => (await web("/web/config", KEY)).json();
  const save = (key, text) => web("/web/config", KEY, { key, text });
  const ofKind = async (kind) => (await log()).filter((e) => e.kind === kind);
  // The resident starts again about a second after a new token or webhook secret; wait until it answers again.
  const restarted = async () => {
    await sleep(2500);
    for (let i = 0; i < 50; i += 1) {
      if ((await web("/web/check", KEY).catch(() => null))?.status === 200) return;
      await sleep(200);
    }
    throw new Error("the resident did not come back");
  };
  const initData = (token) => {
    const fields = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: "AAH-test", user: JSON.stringify({ id: 42, first_name: "Her", username: "her_test" }) };
    const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
    const key = crypto.createHmac("sha256", "WebAppData").update(token).digest();
    return new URLSearchParams({ ...fields, hash: crypto.createHmac("sha256", key).update(check).digest("hex") }).toString();
  };
  let secret;

  await step("no bot token: the webhook and /tg/setup turn everyone away, and the page says Telegram is not connected", async () => {
    assert.equal((await post("在吗", { secret: "anything" })).status, 401);
    const setup = await fetch(`${WORKER}/tg/setup?secret=anything`);
    assert.equal(setup.status, 400);
    assert.match(await setup.text(), /settings page \(聊天渠道 → Telegram\)/);
    assert.deepEqual((await config()).telegram, { from: null, bot: null, here: false, error: null, lastError: null });
    assert.equal((await ofKind("tg.getMe")).length, 0, "nothing asked of Telegram without a token");
  });

  await step("something that is not a bot token is refused with what one looks like", async () => {
    const response = await save("TG_BOT_TOKEN", "not-a-token");
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /bot token 长这样/);
  });

  await step("a token saved on the settings page connects the bot here, with a webhook secret the resident made itself", async () => {
    const response = await save("TG_BOT_TOKEN", TOKEN);
    assert.equal(response.status, 200, await response.clone().text());
    const page = await response.json();
    const hook = (await ofKind("tg.setWebhook")).at(-1);
    assert.equal(hook.token, TOKEN);
    assert.equal(hook.body.url, HOOK);
    assert.match(hook.body.secret_token, /^[0-9a-f]{48}$/);
    secret = hook.body.secret_token;
    assert.equal((await ofKind("tg.getMe")).at(0).token, TOKEN);
    assert.equal((await ofKind("tg.setMyCommands")).at(-1).token, TOKEN);
    assert.equal((await ofKind("tg.setChatMenuButton")).length, 0, "no Mini App button over http");
    assert.deepEqual(page.telegram, { from: "page", bot: "resident_test_bot", here: true, error: null, lastError: null });
    const field = page.fields.find((f) => f.key === "TG_BOT_TOKEN");
    assert.deepEqual([field.saved, field.value], [true, ""], "the token itself is never sent back");
    assert.ok(!page.fields.some((f) => f.key === "TG_WEBHOOK_SECRET"), "the made secret is not a setting");
    const text = JSON.stringify(page);
    assert.ok(!text.includes(TOKEN) && !text.includes(secret), "neither the token nor the secret is on the page");
  });

  await step("after starting again it answers on Telegram with the new token, and only with the secret it made", async () => {
    await restarted();
    const before = (await sent()).length;
    assert.equal((await post("你好", { secret: "test-secret" })).status, 401, "the old secret");
    assert.equal((await post("你好", { secret })).status, 200);
    await waitForSends(before, 1);
    assert.equal((await ofKind("tg.sendMessage")).at(-1).token, TOKEN);
  });

  await step("commands and the Mini App go by the token on the page", async () => {
    const before = (await sent()).length;
    assert.equal((await post("/status", { secret })).status, 200);
    assert.match((await waitForSends(before, 1)).join("\n"), /模型/);
    assert.equal((await ofKind("tg.sendMessage")).at(-1).token, TOKEN);
    const viaNew = await fetch(`${WORKER}/web/check`, { headers: { "x-telegram-init-data": initData(TOKEN) } });
    assert.equal(viaNew.status, 200);
    assert.equal((await viaNew.json()).via, "telegram");
    const viaOld = await fetch(`${WORKER}/web/check`, { headers: { "x-telegram-init-data": initData("123456:test-token") } });
    assert.equal(viaOld.status, 401, "signed with the Cloudflare token, which is not in effect");
  });

  await step("「重新接一次」 points the bot here again with the same secret, and does not start the resident again", async () => {
    const hooks = (await ofKind("tg.setWebhook")).length;
    const response = await web("/web/telegram/connect", KEY, {});
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).telegram.here, true);
    const hook = (await ofKind("tg.setWebhook")).slice(hooks);
    assert.equal(hook.length, 1);
    assert.equal(hook[0].body.secret_token, secret);
    await sleep(2000);
    const before = (await sent()).length;
    assert.equal((await post("还在吗", { secret })).status, 200);
    await waitForSends(before, 1);
  });

  await step("a token Telegram refuses shows up on the page, and the old bot is let go", async () => {
    const bad = `654321:bad${"B".repeat(32)}`;
    const response = await save("TG_BOT_TOKEN", bad);
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.equal(page.telegram.from, "page");
    assert.match(page.telegram.error, /Telegram 不认这个 token/);
    assert.equal((await ofKind("tg.deleteWebhook")).at(-1).token, TOKEN, "the bot before it stops sending here");
    const connect = await web("/web/telegram/connect", KEY, {});
    assert.equal(connect.status, 400);
    assert.match((await connect.json()).error, /Telegram 不认这个 token/);
    await restarted();
  });

  await step("taking the token off closes the Telegram door again", async () => {
    const response = await save("TG_BOT_TOKEN", "");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).telegram.from, null);
    await restarted();
    assert.equal((await post("在吗", { secret })).status, 401);
    assert.equal((await fetch(`${WORKER}/web/check`, { headers: { "x-telegram-init-data": initData(TOKEN) } })).status, 401);
    assert.equal((await web("/web/telegram/connect", KEY, {})).status, 400);
  });
}

if (phase === "stall") {
  await fetch(`${MOCK}/__reset`);
  await step("a turn whose model goes quiet is cut and run again, and she gets the reply", async () => {
    const before = (await sent()).length;
    const started = Date.now();
    assert.equal((await post("卡住测试")).status, 200);
    const out = await waitForSends(before, 1, 30000);
    assert.ok(out.some((text) => text.includes("刚才卡住了，现在好了。")), JSON.stringify(out));
    // Cut after CHAT_STALL_SECONDS (2), not held until the connection drops.
    assert.ok(Date.now() - started < 25000);
  });
  await step("a message after it is answered as usual", async () => {
    const before = (await sent()).length;
    await post("你好");
    const out = await waitForSends(before, 1, 20000);
    assert.ok(out.length >= 1, JSON.stringify(out));
  });
}

if (phase === "claude-code") {
  await fetch(`${MOCK}/__reset`);
  const KEY = "test-web-key";
  const turns = async () => (await log()).filter((e) => e.kind === "claudebox.turn");
  const say = async (text, options) => {
    const before = (await sent()).length;
    await post(text, options);
    return (await waitForSends(before, 1, 30000))[0];
  };
  const counts = (reply) => {
    const m = reply.match(/（接着 (\d+) 条，重写 (\d+) 条）$/);
    assert.ok(m, reply);
    return { reused: Number(m[1]), written: Number(m[2]) };
  };

  await step("the setup token is filled in, never shown, and one Claude refuses is reported when switching", async () => {
    // An address that is not one is not saved.
    const where = await web("/web/config", KEY, { key: "CLAUDE_BOX_URL", text: "not an address" });
    assert.equal(where.status, 400);
    // Plain http only to this machine: the box key, the token and the conversation would go out in the clear.
    const plain = await web("/web/config", KEY, { key: "CLAUDE_BOX_URL", text: "http://claude-box.example.com" });
    assert.equal(plain.status, 400);
    assert.match(JSON.stringify(await plain.json()), /https:\/\//);
    assert.equal((await web("/web/config", KEY, { key: "CLAUDE_CODE_OAUTH_TOKEN", text: "not-a-token" })).status, 400);
    let response = await web("/web/config", KEY, { key: "CLAUDE_CODE_OAUTH_TOKEN", text: "sk-ant-oat01-revoked-0123456789abcdefghij" });
    assert.equal(response.status, 200);
    const field = (await response.json()).fields.find((f) => f.key === "CLAUDE_CODE_OAUTH_TOKEN");
    assert.ok(field, "the field is listed");
    assert.doesNotMatch(JSON.stringify(field), /revoked/);
    response = await web("/web/model", KEY, { text: "claude-code/claude-opus-5-5" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /setup token 不对或过期/);
    assert.equal((await (await web("/web/model", KEY)).json()).model, "", "nothing switched");
    // Cleared on the page, the Worker's own one applies again.
    await web("/web/config", KEY, { key: "CLAUDE_CODE_OAUTH_TOKEN", text: "" });
    response = await web("/web/model", KEY, { text: "claude-code/claude-opus-5-5" });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const trial = (await turns()).at(-1);
    assert.equal(trial.token, "sk-ant-oat01-test-token-for-the-fake-box");
    assert.equal(trial.model, "claude-opus-5-5");
    assert.deepEqual(trial.items, [], "the trial call is one call on its own");
    assert.equal(trial.thinking, "summarized", "the trial call is shaped like the chat");
    assert.equal(trial.system, "You are a test assistant.");
  });

  let written = 0;
  await step("her turns go to the box with the whole conversation, and what the box wrote comes back on the next one", async () => {
    await fetch(`${MOCK}/__reset`);
    const first = await say("第一句");
    assert.match(first, /^订阅收到：第一句（/);
    ({ written } = counts(first));
    assert.equal(counts(first).reused, 0);
    const turn = (await turns()).at(-1);
    assert.match(turn.system, /chat app/, "the resident's own system prompt");
    assert.equal(turn.thinking, "summarized", "Opus 5.5's thinking is asked to be shown");
    assert.equal(turn.effort, null, "auto: the model's own effort");
    assert.equal(await say("第二句"), `订阅收到：第二句（接着 2 条，重写 ${written} 条）`);
    assert.equal(await say("第三句"), `订阅收到：第三句（接着 4 条，重写 ${written} 条）`);
    // Nothing goes out through Aelios' model endpoint: the resident recalls and records her turns itself.
    const all = await log();
    assert.equal(all.filter((e) => e.kind === "aelios.messages" || e.kind === "aelios.chat").length, 0);
    const recalls = all.filter((e) => e.kind === "aelios.recall");
    assert.equal(recalls.length, 3);
    assert.equal(recalls.at(-1).body.query, "第三句", "her words without the time stamp");
    const ingests = all.filter((e) => e.kind === "aelios.ingest" && e.body.source === "aelios-resident");
    assert.equal(ingests.length, 3);
    assert.deepEqual(ingests.at(-1).body.messages.map((m) => m.role), ["user", "assistant"]);
    assert.match(ingests.at(-1).body.messages[0].content, /^\[[^\]]+\] 第三句$/);
    assert.equal(ingests.at(-1).body.messages[1].content, `订阅收到：第三句（接着 4 条，重写 ${written} 条）`);
    // What the box reported reached /status and the web page: read from the cache, written to it.
    const model = await (await web("/web/model", KEY)).json();
    assert.equal(model.lastUsage.cacheRead, 400);
    assert.equal(model.lastUsage.cacheWrite, 50);
    assert.equal(model.memoryOff, false);
  });

  await step("what memory brings up goes after her words, and the box gets the resident's tools", async () => {
    const reply = await say("我生日是哪天？");
    assert.match(reply, /^订阅收到：我生日是哪天？/);
    const turn = (await turns()).at(-1);
    assert.match(turn.prompt[0].text, /我生日是哪天？$/);
    assert.equal(turn.prompt.at(-1).type, "text");
    assert.match(turn.prompt.at(-1).text, /^\[Aelios 记忆\]\n- 她的生日在春天$/);
    assert.doesNotMatch(turn.system, /no tools/);
    const notebook = turn.tools.find((tool) => tool.name === "memory_notebook");
    assert.ok(notebook?.input_schema?.properties?.action, JSON.stringify(turn.tools.map((tool) => tool.name)));
    assert.ok(turn.tools.every((tool) => !tool.cache_control && !tool.type), "her own tools, without cache marks");
    // The next turn carries her words as the box wrote them, memory and all, so the cache still matches.
    assert.equal(counts(await say("好的")).reused, 8);
    assert.match(JSON.stringify((await turns()).at(-1).history.at(-2)), /她的生日在春天/);
  });

  await step("Claude in the box calls a tool: the resident runs it, the result goes back, and the turn is recorded once", async () => {
    const before = await log();
    const reply = await say("帮我记小本本：今天学完第 30 章");
    assert.match(reply, /小本本记好了：\{"data":\{"id":"mem-new","created":true\}\}/);
    const all = (await log()).slice(before.length);
    const [ask, answer] = all.filter((e) => e.kind === "claudebox.turn");
    assert.ok(ask && answer, "two calls to the box");
    assert.equal(all.filter((e) => e.kind === "claudebox.turn").length, 2);
    const call = all.find((e) => e.kind === "aelios.mcp" && e.body.params?.name === "notebook");
    assert.deepEqual({ ...call.body.params.arguments, namespace: undefined }, { action: "append", name: "测试", content: "今天学完第 30 章", namespace: undefined });
    assert.equal(answer.prompt.length, 1);
    assert.equal(answer.prompt[0].type, "tool_result");
    assert.match(answer.prompt[0].tool_use_id, /^toolu_box_/);
    assert.match(JSON.stringify(answer.prompt[0].content), /mem-new/);
    // The call came back as the box wrote it, so the box goes on from its own entries.
    assert.equal(answer.items.at(-1), "entries");
    assert.equal(all.filter((e) => e.kind === "aelios.recall").length, 1, "recalled once, for her words");
    const ingests = all.filter((e) => e.kind === "aelios.ingest" && e.body.source === "aelios-resident");
    assert.equal(ingests.length, 1, "recorded once, when answered");
    assert.match(ingests[0].body.messages[0].content, /帮我记小本本/);
    assert.match(ingests[0].body.messages[1].content, /^我记一下。小本本记好了：/);
    // And the whole round comes back as the box's own entries on the next turn.
    const next = counts(await say("记好了吗"));
    assert.equal(next.written, written);
  });

  await step("after the tool, words that say nothing or only repeat the reply are not sent and not recorded", async () => {
    for (const asked of ["帮我记小本本，没话说：今天学完第 30 章", "帮我记小本本，说两遍：今天学完第 30 章"]) {
      const before = await log();
      const sends = (await sent()).length;
      assert.equal(await say(asked), "我记一下。");
      await sleep(1500);
      assert.deepEqual((await sent()).slice(sends), ["我记一下。"], asked);
      const all = (await log()).slice(before.length);
      assert.equal(all.filter((e) => e.kind === "claudebox.turn").length, 2, "the box went on after the tool");
      const ingests = all.filter((e) => e.kind === "aelios.ingest" && e.body.source === "aelios-resident");
      assert.equal(ingests.length, 1);
      assert.equal(ingests[0].body.messages[1].content, "我记一下。");
      const kept = (await (await web("/web/messages", KEY)).json()).data.filter((line) => line.role === "assistant").at(-1);
      assert.equal(kept.text, "我记一下。");
    }
    // The turn after goes on as usual; the last call's result goes with her words (the box tells the two as text).
    const next = await say("记好了吗");
    assert.match(next, /^订阅收到：记好了吗（/);
    assert.match(JSON.stringify((await turns()).at(-1).prompt), /toolu_box_again_/);
  });

  await step("the box key on the settings page goes with every turn; one the box does not take is reported", async () => {
    assert.equal((await web("/web/config", KEY, { key: "CLAUDE_BOX_KEY", text: "short" })).status, 400);
    const boxKey = "k".repeat(40);
    assert.equal((await web("/web/config", KEY, { key: "CLAUDE_BOX_KEY", text: boxKey })).status, 200);
    await say("带钥匙");
    assert.equal((await turns()).at(-1).auth, `Bearer ${boxKey}`);
    await fetch(`${MOCK}/__faults`, { method: "POST", body: JSON.stringify({ claudeBox: "key" }) });
    const response = await web("/web/model", KEY, { text: "claude-code/claude-sonnet-5-5" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /不认这把钥匙/);
    await fetch(`${MOCK}/__faults`, { method: "POST", body: JSON.stringify({ claudeBox: "up" }) });
    await web("/web/config", KEY, { key: "CLAUDE_BOX_KEY", text: "" });
  });

  await step("Claude thinks as long as the settings page says", async () => {
    await web("/web/config", KEY, { key: "THINKING_EFFORT", text: "high" });
    await say("想深一点");
    assert.equal((await turns()).at(-1).effort, "high");
    await web("/web/config", KEY, { key: "THINKING_EFFORT", text: "" });
    await say("回到默认");
    assert.equal((await turns()).at(-1).effort, null);
  });

  await step("a picture she sends goes to the box as a picture", async () => {
    const reply = await say("看图", { photo: "photo-box" });
    assert.match(reply, /^订阅收到：/);
    const prompt = (await turns()).at(-1).prompt;
    assert.ok(prompt.some((b) => b.type === "image" && b.source?.type === "base64"), JSON.stringify(prompt).slice(0, 300));
    assert.equal(counts(await say("看到了吗")).written, written, "the picture comes back as the box wrote it");
  });

  await step("a letter folds the old chat: the box gets the letter as it is, then carries on with its own entries", async () => {
    await fillChat();
    const before = (await sent()).length;
    await post("/handoff");
    const [out] = await waitForSends(before, 1, 30000);
    assert.match(out, /^交接信写好了/);
    const letterTurn = (await turns()).at(-1);
    assert.match(JSON.stringify(letterTurn.prompt), /time to write a handoff letter/);
    assert.doesNotMatch(JSON.stringify(letterTurn.prompt), /Aelios 记忆\]/, "a note is not recalled for");
    const after = counts(await say("写完信之后"));
    assert.ok(after.written >= 1, JSON.stringify(after));
    const next = counts(await say("再来一句"));
    assert.equal(next.written, after.written, "the letter and what was kept go as they are");
    assert.equal(next.reused, after.reused + 2);
  });

  await step("a turn cut off halfway: she is told, and the conversation goes on", async () => {
    const before = (await sent()).length;
    await post("半路断");
    const got = await waitForSends(before, 1, 30000);
    assert.ok(got.some((t) => /断了|出错了|订阅收到：半路断/.test(t)), JSON.stringify(got));
    assert.match(await say("接着说"), /^订阅收到：接着说（/);
  });

  await step("switching to the box while it is down, or while its address redirects, says why, and the model stays", async () => {
    await fetch(`${MOCK}/__faults`, { method: "POST", body: JSON.stringify({ claudeBox: "down" }) });
    const response = await web("/web/model", KEY, { text: "claude-code/claude-sonnet-5-5" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Claude 盒子没接这一轮（502）/);
    // A box address that redirects: the turn, with the token and the box key, is not sent on.
    await fetch(`${MOCK}/__faults`, { method: "POST", body: JSON.stringify({ claudeBox: "redirect" }) });
    const moved = await web("/web/model", KEY, { text: "claude-code/claude-sonnet-5-5" });
    assert.equal(moved.status, 400);
    assert.match((await moved.json()).error, /Claude 盒子没接这一轮（307）/);
    assert.equal((await log()).filter((e) => e.kind === "claudebox.elsewhere").length, 0, "nothing followed the redirect");
    await fetch(`${MOCK}/__faults`, { method: "POST", body: JSON.stringify({ claudeBox: "up" }) });
    assert.equal((await (await web("/web/model", KEY)).json()).model, "claude-code/claude-opus-5-5");
  });

  await step("on another model and back: what was said there goes to the box as it is", async () => {
    assert.equal((await web("/web/model", KEY, { text: "fake" })).status, 200);
    await say("换到别的模型说一句");
    assert.equal((await web("/web/model", KEY, { text: "claude-code/claude-opus-5-5" })).status, 200);
    const back = counts(await say("回来了"));
    const again = counts(await say("还在吗"));
    assert.equal(again.reused, back.reused + 2);
    assert.equal(again.written, back.written);
  });
}

if (phase === "crash-1") {
  await fetch(`${MOCK}/__reset`);
  await post("慢慢说");
  const start = Date.now();
  while (!(await sent()).length) {
    if (Date.now() - start > 20000) throw new Error("no first bubble");
    await sleep(100);
  }
  console.log("first bubble out:", JSON.stringify(await sent()));
}

if (phase === "crash-2") {
  await sleep(15000);
  console.log("after restart she got:", JSON.stringify(await sent()));
}

if (phase === "web") {
  await fetch(`${MOCK}/__reset`);
  const KEY = "test-web-key";
  const json = async (path, body) => {
    const response = await web(path, KEY, body);
    return { status: response.status, data: await response.json() };
  };
  const set = async (settings) => {
    for (const [key, text] of Object.entries(settings)) {
      const response = await web("/web/config", KEY, { key, text });
      assert.equal(response.status, 200, `${key}: ${await response.clone().text()}`);
    }
  };
  const lines = async () => (await json("/web/messages")).data.data;
  const say = async (body) => {
    const { status, data } = await json("/web/say", body);
    assert.equal(status, 200, JSON.stringify(data));
    return data;
  };
  // A 16 kHz mono WAV of silence, as the page records one.
  const wav = (seconds) => {
    const n = 16000 * seconds;
    const b = Buffer.alloc(44 + n * 2);
    b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
    b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24);
    b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
    return b.toString("base64");
  };
  const png = Buffer.from(PNG).toString("base64");

  await step("words from the web are answered there and not sent to Telegram; pictures go with them and are shown from /web/picture", async () => {
    assert.deepEqual(await say({ text: "你好" }), { status: "completed" });
    assert.deepEqual(await say({ text: "看图", pictures: [{ data: png }, { data: png }] }), { status: "completed" });
    const all = await lines();
    const mine = all.findLast((line) => line.role === "user");
    assert.deepEqual([mine.text, mine.pictures, mine.via], ["看图", 2, "web"]);
    assert.equal(all.at(-1).text, "看到 2 张图。", "the model saw both");
    const picture = await web(`/web/picture?id=${encodeURIComponent(mine.id)}&n=1`, KEY);
    assert.equal(picture.status, 200);
    assert.match(picture.headers.get("content-type"), /^image\//);
    assert.equal((await sent()).length, 0, "nothing went to Telegram");
  });

  await step("a picture that is not one, or an empty message, is refused and nothing is saved", async () => {
    const before = (await lines()).length;
    const bad = await json("/web/say", { text: "x", pictures: [{ data: Buffer.from("<svg></svg>").toString("base64") }] });
    assert.equal(bad.status, 400);
    assert.match(bad.data.error, /不是一张能看的图片/);
    assert.equal((await json("/web/say", { text: "x", pictures: [{ data: "%%%" }] })).status, 400);
    assert.deepEqual(await say({ text: "   " }), { status: "empty" });
    assert.equal((await lines()).length, before);
  });

  await step("quoting a line: the model is told what she replies to, and the page shows the quote", async () => {
    const reply = (await lines()).findLast((line) => line.role === "assistant");
    await say({ text: "回你这句", quote: reply.id });
    const all = await lines();
    const mine = all.findLast((line) => line.role === "user");
    assert.deepEqual([mine.text, mine.quote], ["回你这句", { who: "assistant", text: "看到 2 张图。" }]);
    assert.match(all.at(-1).text, /\[replying to your message: "看到 2 张图。"\]\n回你这句/);
    await say({ text: "引用一条没有的", quote: "no-such-message" });
    assert.equal((await lines()).findLast((line) => line.role === "user").quote, undefined, "a quote it cannot find is left out");
  });

  await step("a voice message recorded on the web is kept to play back and, with no one to hear it, marked unheard", async () => {
    await say({ voice: { data: wav(2) } });
    const all = await lines();
    const mine = all.findLast((line) => line.role === "user");
    assert.equal(mine.voice.seconds, 2);
    assert.equal(mine.voice.missed, true);
    assert.match(mine.voice.key, /^[0-9a-f]{32}$/);
    assert.match(all.at(-1).text, /\[voice 0:02, could not be heard\]/, "the model is told");
    const audio = await web(`/web/media?key=${mine.voice.key}`, KEY);
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get("content-type"), "audio/wav");
    assert.equal(audio.headers.get("content-security-policy"), "sandbox");
    assert.equal((await audio.arrayBuffer()).byteLength, 44 + 16000 * 2 * 2);
    assert.equal((await web(`/web/media?key=${mine.voice.key}`, "wrong")).status, 401);
    assert.equal((await web("/web/media?key=../../x", KEY)).status, 404);
    const garbled = await json("/web/say", { voice: { data: Buffer.from("not audio at all").toString("base64") } });
    assert.equal(garbled.status, 400);
  });

  await step("with a voice set up, her web voice message is heard, the reply comes with its voice, and any reply can be read out", async () => {
    await set({ VOICE_BASE_URL: "http://127.0.0.1:9999/voice", VOICE_API_KEY: "test-voice-key", VOICE_PROVIDER: "elevenlabs", VOICE_ID: "voice-123" });
    await say({ voice: { data: wav(1) } });
    let all = await lines();
    const mine = all.findLast((line) => line.role === "user");
    assert.deepEqual([mine.text, mine.voice.seconds, Boolean(mine.voice.missed)], ["网页上说的话", 1, false]);
    // The voice is made after the reply is in, so it can take a moment.
    const start = Date.now();
    while (!(all.at(-1).voice && all.at(-1).voice.key) && Date.now() - start < 15000) {
      await sleep(300);
      all = await lines();
    }
    const spoken = all.at(-1).voice;
    assert.ok(spoken && /^[0-9a-f]{32}$/.test(spoken.key), "the reply to a voice message has its voice");
    assert.equal((await web(`/web/media?key=${spoken.key}`, KEY)).headers.get("content-type"), "audio/mpeg");
    const earlier = all.find((line) => line.role === "assistant" && !line.voice);
    const read = await json("/web/speak", { id: earlier.id });
    assert.equal(read.status, 200, JSON.stringify(read.data));
    assert.match(read.data.key, /^[0-9a-f]{32}$/);
    const again = await json("/web/speak", { id: earlier.id });
    assert.equal(again.data.key, read.data.key, "read once, kept");
    assert.equal((await lines()).find((line) => line.id === earlier.id).voice.key, read.data.key, "and shown with the message");
    assert.equal((await json("/web/speak", { id: mine.id })).status, 400, "only its own lines");
    assert.equal((await sent()).length, 0, "nothing went to Telegram");
    // send_voice in a turn on the web, with no Telegram or WeCom chat: made all the same, and shown with its reply.
    await set({ VOICE_REPLY: "tool" });
    await say({ text: "发条语音" });
    all = await lines();
    const sentVoice = all.findLast((line) => line.role === "assistant");
    assert.ok(sentVoice.activity.some((item) => item.name === "send_voice" && /Sent as a voice message/.test(item.output)), JSON.stringify(sentVoice.activity));
    assert.match(sentVoice.voice?.key ?? "", /^[0-9a-f]{32}$/, "the voice it sent is on the web page");
    assert.equal((await web(`/web/media?key=${sentVoice.voice.key}`, KEY)).headers.get("content-type"), "audio/mpeg");
    await set({ VOICE_PROVIDER: "", VOICE_ID: "", VOICE_API_KEY: "", VOICE_BASE_URL: "", VOICE_REPLY: "" });
    assert.equal((await json("/web/speak", { id: earlier.id })).data.key, read.data.key, "a voice already made still plays");
    const unspoken = (await lines()).find((line) => line.role === "assistant" && !line.voice);
    assert.match((await json("/web/speak", { id: unspoken.id })).data.error ?? "", /还没设置声音/);
  });

  await step("a sticker of hers from an imported pack: the model reads what it means, the page shows it", async () => {
    const pack = zip([
      { name: "pack.json", data: JSON.stringify({ format: "resident-stickers/1", name: "Mine", stickers: [{ id: "hug", file: "hug.png", emoji: "🤗", when: "A hug." }] }), deflate: true },
      { name: "hug.png", data: PNG, deflate: true }
    ]);
    const imported = await fetch(`${WORKER}/web/stickers/import?name=mine.zip`, { method: "POST", headers: { "x-web-key": KEY, "content-type": "application/zip" }, body: pack });
    assert.equal(imported.status, 200, await imported.clone().text());
    const packs = (await json("/web/stickers")).data.packs;
    const key = packs.flatMap((p) => p.stickers).find((s) => s.emoji === "🤗").key;
    await say({ sticker: key });
    const all = await lines();
    const mine = all.findLast((line) => line.role === "user");
    assert.deepEqual([mine.text, mine.stickers], ["", [{ url: `/stickers/${key}`, video: false }]]);
    assert.match(all.at(-1).text, /\[sticker 🤗 A hug\.\]/);
    assert.equal((await json("/web/say", { sticker: "0".repeat(24) })).status, 400, "only stickers from a pack that is on");
  });

  await step("the buttons for /status, /letter and /handoff answer as the commands do; nothing else runs", async () => {
    const status = await json("/web/command", { name: "status" });
    assert.equal(status.status, 200);
    assert.match(status.data.text, /模型/);
    assert.equal((await json("/web/command", { name: "letter" })).status, 200);
    const other = await json("/web/command", { name: "rm" });
    assert.deepEqual([other.status, other.data.error], [400, "没有这个命令"]);
  });

  await step("a model change shows as a line in the chat, at the time it happened", async () => {
    const picked = await json("/web/model", { text: "fake" });
    assert.equal(picked.status, 200, JSON.stringify(picked.data));
    const notice = (await lines()).findLast((line) => line.kind === "notice");
    assert.ok(notice, "a notice line");
    assert.match(notice.text, /fake/);
    assert.ok(notice.at > 0);
  });

  await step("its name and avatar: set on its page, shown to the page, the home-screen app and its icon", async () => {
    let check = (await json("/web/check")).data;
    assert.deepEqual([check.name, check.avatar], ["住户", null]);
    assert.equal((await web("/web/config", KEY, { key: "RESIDENT_NAME", text: "名".repeat(21) })).status, 400, "at most 20 characters");
    await set({ RESIDENT_NAME: "小助手" });
    const upload = await fetch(`${WORKER}/web/avatar`, { method: "POST", headers: { "x-web-key": KEY, "content-type": "image/png" }, body: PNG });
    assert.equal(upload.status, 200, await upload.clone().text());
    const { avatar } = await upload.json();
    assert.match(avatar, /^\/avatar\/[0-9a-f]{32}$/);
    check = (await json("/web/check")).data;
    assert.deepEqual([check.name, check.avatar], ["小助手", avatar]);
    const shown = await fetch(`${WORKER}${avatar}`);
    assert.equal(shown.status, 200, "public, like a sticker");
    assert.equal(shown.headers.get("content-type"), "image/png");
    const app = await fetch(`${WORKER}/manifest.webmanifest`);
    assert.match(app.headers.get("content-type"), /manifest\+json/);
    const manifest = await app.json();
    assert.deepEqual([manifest.name, manifest.display, manifest.start_url], ["小助手", "standalone", "/"]);
    assert.equal(manifest.icons[0].src, avatar);
    const notPicture = await fetch(`${WORKER}/web/avatar`, { method: "POST", headers: { "x-web-key": KEY, "content-type": "image/png" }, body: "hello" });
    assert.equal(notPicture.status, 400);
    const tooBig = await fetch(`${WORKER}/web/avatar`, { method: "POST", headers: { "x-web-key": KEY, "content-type": "image/png" }, body: new Uint8Array(600 * 1024) });
    assert.equal(tooBig.status, 413);
    assert.equal((await fetch(`${WORKER}/web/avatar`, { method: "POST", body: PNG })).status, 401, "only with the web key");
    assert.deepEqual((await json("/web/avatar/remove", {})).data, { id: "default", name: "小助手", avatar: null });
    assert.equal((await fetch(`${WORKER}${avatar}`)).status, 404, "a removed avatar is gone");
    assert.equal((await (await fetch(`${WORKER}/manifest.webmanifest`)).json()).icons[0].src, "/icon-192.png");
  });

  await step("notifications: the page gets the resident's own key; a device that is not a push service is refused", async () => {
    const state = (await json("/web/push")).data;
    assert.match(state.publicKey, /^[A-Za-z0-9_-]{87}$/, "an uncompressed P-256 key, base64url");
    assert.equal(state.devices, 0);
    assert.equal((await json("/web/push")).data.publicKey, state.publicKey, "made once, kept");
    for (const subscription of [null, { endpoint: "http://push.example/x", keys: { p256dh: "a", auth: "b" } }, { endpoint: "https://push.example/x" }]) {
      assert.equal((await json("/web/push/subscribe", { subscription })).status, 400, JSON.stringify(subscription));
    }
    assert.deepEqual((await json("/web/push/test", {})).data, { sent: 0, failed: [] }, "no device, nothing sent");
    assert.equal((await web("/web/push", "wrong")).status, 401);
  });

  await step("an alarm it set can be moved from the page: a daily one to another time, a one-time one to another day", async () => {
    await set({ ALARMS: "on" });
    await say({ text: "每天早上叫我" });
    await say({ text: "等会儿提醒我喝水" });
    const { alarms } = (await json("/web/alarms")).data;
    const daily = alarms.find((alarm) => alarm.note === "叫她起床");
    const once = alarms.find((alarm) => alarm.note === "提醒她喝水");
    assert.deepEqual([daily.edit, daily.time, once.edit], ["time", "09:00", "date"]);
    const moved = await json("/web/alarms/edit", { id: daily.id, when: "07:30" });
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    const now = moved.data.alarms.find((alarm) => alarm.id === daily.id);
    assert.deepEqual([now.when, now.time], ["每天 07:30", "07:30"]);
    assert.match(now.next, / 07:30$/);
    const later = new Date(Date.now() + 3 * 86400_000);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(later);
    const onceMoved = await json("/web/alarms/edit", { id: once.id, when: `${day} 21:15` });
    assert.equal(onceMoved.status, 200, JSON.stringify(onceMoved.data));
    assert.deepEqual(Object.values((({ date, time }) => ({ date, time }))(onceMoved.data.alarms.find((alarm) => alarm.id === once.id))), [day, "21:15"]);
    assert.match((await json("/web/alarms/edit", { id: once.id, when: "2001-01-01 09:00" })).data.error, /至少一分钟以后/);
    assert.match((await json("/web/alarms/edit", { id: daily.id, when: "七点" })).data.error, /填一个钟点/);
    assert.equal((await json("/web/alarms/edit", { id: "a_nope", when: "07:30" })).status, 400);
    const card = (await lines()).find((line) => line.role === "assistant" && (line.activity ?? []).some((item) => item.name === "set_alarm"));
    assert.ok(card, "the reply that set it carries the set_alarm call its card is drawn from");
  });

  await step("a thread that needs her offers answers; the one she taps is said to the resident, once", async () => {
    await set({ CLOUD_TASKS: "on", CLOUD_TASK_URL: "https://api.anthropic.com/v1/claude_code/routines/trig_testtask01/fire", CLOUD_TASK_TOKEN: "good-token" });
    await say({ text: "派活" });
    const fire = (await log()).filter((e) => e.kind === "routine.fire").at(-1);
    const [, id, code] = fire.body.text.match(/^task: (t_[0-9a-f]{10})\ncode: ([0-9a-f]{32})\n/) ?? [];
    assert.ok(id && code);
    const asked = await fetch(`${WORKER}/tasks/${id}/result`, { method: "POST", headers: { "content-type": "application/json", "x-task-code": code },
      body: JSON.stringify({ status: "needs_you", summary: "用哪个标题？", choices: ["短的", "长的", "短的"] }) });
    assert.equal(asked.status, 200);
    const start = Date.now();
    let card;
    while (!card && Date.now() - start < 15000) {
      card = (await lines()).flatMap((line) => line.tasks ?? []).find((task) => task.id === id && task.status === "needs_you");
      if (!card) await sleep(300);
    }
    assert.ok(card, "the card shows it waits for her");
    assert.deepEqual([card.choices, card.chosen], [["短的", "长的"], ""]);
    assert.equal((await json("/web/task/choose", { id, text: "中等的" })).status, 400, "only an answer it offered");
    const chose = await json("/web/task/choose", { id, text: "长的" });
    assert.equal(chose.status, 200, JSON.stringify(chose.data));
    const all = await lines();
    assert.equal(all.findLast((line) => line.role === "user").text, "关于「修 README 的错字」：长的");
    assert.equal(all.flatMap((line) => line.tasks ?? []).find((task) => task.id === id).chosen, "长的");
    assert.equal((await json("/web/task/choose", { id, text: "短的" })).status, 400, "once");
    assert.equal(all.flatMap((line) => line.tasks ?? []).find((task) => task.id === id).waiting, false, "a pick deals with it");
  });

  await step("a look with the version the page has gets 'the same' back, reading nothing, until something it shows changes", async () => {
    const look = async (since) => (await json(`/web/messages${since ? `?since=${encodeURIComponent(since)}` : ""}`)).data;
    const first = await look();
    assert.ok(Array.isArray(first.data) && /^[0-9a-f]{8}\.\d+$/.test(first.rev), JSON.stringify(first.rev));
    assert.deepEqual(await look(first.rev), { same: true, rev: first.rev });
    assert.ok(Array.isArray((await look("0000000.0")).data), "another version (a page from before a restart) reads all of it");
    let rev = first.rev;
    const changed = async (what) => {
      const now = await look(rev);
      assert.ok(Array.isArray(now.data) && now.rev !== rev, `${what} changes the version`);
      assert.deepEqual(await look(now.rev), { same: true, rev: now.rev }, `and then it is the same again (${what})`);
      rev = now.rev;
    };
    await say({ text: "又来一句" });
    await changed("her words and the reply");
    assert.equal((await json("/web/model", { text: "" })).status, 200);
    await changed("a notice in the chat");
    await say({ text: "派活" });
    await changed("a thread sent");
    const fire = (await log()).filter((e) => e.kind === "routine.fire").at(-1);
    const [, id, code] = fire.body.text.match(/^task: (t_[0-9a-f]{10})\ncode: ([0-9a-f]{32})\n/) ?? [];
    assert.equal((await fetch(`${WORKER}/tasks/${id}/progress`, { method: "POST", headers: { "content-type": "application/json", "x-task-code": code }, body: JSON.stringify({ line: "改到一半" }) })).status, 200);
    await changed("a thread's progress on its card");
  });

  await step("one that waits for her with nothing to pick is put aside with 不用了, and stops asking everywhere", async () => {
    const fire = (await log()).filter((e) => e.kind === "routine.fire").at(-1);
    const [, id, code] = fire.body.text.match(/^task: (t_[0-9a-f]{10})\ncode: ([0-9a-f]{32})\n/) ?? [];
    const asked = await fetch(`${WORKER}/tasks/${id}/result`, { method: "POST", headers: { "content-type": "application/json", "x-task-code": code },
      body: JSON.stringify({ status: "needs_you", summary: "要你看一下 PR。" }) });
    assert.equal(asked.status, 200);
    const waiting = async () => ({
      card: (await lines()).flatMap((line) => line.tasks ?? []).find((task) => task.id === id)?.waiting,
      recent: (await json("/web/tasks")).data.tasks.find((task) => task.id === id)?.waiting,
      thread: (await json("/web/threads")).data.threads.find((thread) => thread.id === id)?.waiting,
      page: (await json(`/web/thread?id=${id}`)).data.tasks.find((task) => task.id === id)?.waiting
    });
    const start = Date.now();
    while (!(await waiting()).card && Date.now() - start < 15000) await sleep(300);
    assert.deepEqual(await waiting(), { card: true, recent: true, thread: true, page: true });
    assert.equal((await json("/web/tasks")).data.open, 1, "the count on the threads button");
    assert.equal((await json("/web/tasks/test", {})).status, 200);
    assert.equal((await json("/web/tasks")).data.open, 1, "a test from the settings page is not counted: it is not a thread");
    assert.equal((await json("/web/task/settle", { id: "t_0000000000" })).status, 400);
    const before = (await lines()).length;
    assert.deepEqual((await json("/web/task/settle", { id })).data, { ok: true });
    assert.deepEqual(await waiting(), { card: false, recent: false, thread: false, page: false });
    assert.equal((await json("/web/tasks")).data.open, 0, "nothing left on the threads button");
    assert.equal((await lines()).length, before, "the resident is not told");
    assert.match((await json("/web/task/settle", { id })).data.error, /不等你了/, "once");
    assert.equal((await web("/web/task/settle", "wrong", { id })).status, 401);
  });

  await step("search: any words of hers or its, newest first, a page at a time, and the messages around a hit", async () => {
    const find = (q, before) => json(`/web/search?q=${encodeURIComponent(q)}${before ? `&before=${before}` : ""}`);
    await say({ text: '那家店叫"蓝月亮"\n记得带 100% 的伞_明天 D:\\照片 Moonlight CAFÉ  au lait' });
    const moon = (await find("蓝月亮")).data;
    assert.equal(moon.next, null);
    const mine = moon.results.find((hit) => hit.role === "user");
    assert.ok(mine, JSON.stringify(moon));
    assert.equal(mine.match, "蓝月亮");
    assert.equal(mine.before, '那家店叫"');
    assert.equal(mine.after, '" 记得带 100% 的伞_明天 D:\\照片 Moonlight CAFÉ au lait', "on one line, without the time stamp");
    assert.equal(typeof mine.at, "number");
    assert.ok(moon.results.some((hit) => hit.role === "assistant"), "its words too");
    assert.equal(moon.results[0].role, "assistant", "newest first");
    // Quotes, line breaks and backslashes are escaped in the stored JSON; % and _ are LIKE's wildcards; across a
    // line break and a run of spaces, and a letter outside ASCII in the other case (test/chat-search.mjs has more).
    for (const q of ['"蓝月亮"', "100%", "伞_明", "D:\\照片", "moonlight", "  蓝月亮  ", '蓝月亮" 记得', "café au lait"]) {
      const { status, data } = await find(q);
      assert.equal(status, 200, q);
      assert.ok(data.results.some((hit) => hit.id === mine.id), `${q}: ${JSON.stringify(data)}`);
    }
    const empty = await find("   ");
    assert.equal(empty.status, 400);
    assert.equal(empty.data.error, "要搜什么？");
    assert.equal((await find("长".repeat(51))).status, 400);
    assert.deepEqual((await find("没人说过的一句话")).data, { results: [], next: null });
    assert.equal((await web("/web/search?q=x", "wrong")).status, 401);

    const around = (await json(`/web/search/around?id=${encodeURIComponent(mine.id)}`)).data;
    const at = around.lines.findIndex((line) => line.hit);
    assert.ok(at > 0, JSON.stringify(around));
    assert.equal(around.lines[at].id, mine.id);
    assert.equal(around.lines[at].text, '那家店叫"蓝月亮"\n记得带 100% 的伞_明天 D:\\照片 Moonlight CAFÉ  au lait', "as she wrote it");
    assert.equal(around.lines[at + 1]?.role, "assistant", "its reply after it");
    assert.ok(around.lines.length <= 9);
    assert.equal((await json("/web/search/around?id=nope")).status, 404);

    for (let i = 1; i <= 16; i += 1) await say({ text: `翻页测试 ${i}` });
    const first = (await find("翻页测试")).data;
    assert.equal(first.results.length, 30, "her 16 and its 16, 30 on a page");
    assert.ok(first.next, "more to come");
    assert.equal(first.results[0].role, "assistant");
    assert.match(first.results[0].after, /^ 16 /);
    const second = (await find("翻页测试", first.next)).data;
    assert.equal(second.next, null);
    assert.deepEqual(second.results.map((hit) => hit.role), ["assistant", "user"]);
    assert.equal(second.results[1].after, " 1", "her first one last");
    assert.equal(new Set([...first.results, ...second.results].map((hit) => hit.id)).size, 32);
  });

  await step("its latest reply can be taken back: deleted, or answered again; not an earlier one, not while it replies", async () => {
    const take = (id, again) => json("/web/take-back", { id, ...(again ? { again: true } : {}) });
    await say({ text: "先说一句" });
    await say({ text: "重来测试" });
    let all = await lines();
    const first = all.at(-1);
    assert.equal(first.text, "第 1 回");
    assert.equal(all.at(-3).role, "assistant");
    assert.deepEqual(await take(all.at(-3).id), { status: 400, data: { error: "只能收回最后一条" } }, "not an earlier reply");
    assert.deepEqual(await take(all.at(-2).id), { status: 400, data: { error: "这条已经不在了" } }, "not her message");
    assert.deepEqual(await take(first.id, true), { status: 200, data: { status: "completed" } });
    all = await lines();
    assert.deepEqual(all.slice(-2).map((line) => [line.role, line.text]), [["user", "重来测试"], ["assistant", "第 2 回"]], "answered again");
    assert.ok(!all.some((line) => line.id === first.id), "the old reply is gone");
    assert.deepEqual(await take(all.at(-1).id), { status: 200, data: { status: "removed" } });
    all = await lines();
    assert.equal(all.at(-1).text, "重来测试", "deleted: her message is the last one again");
    await say({ text: "你上一句说了什么" });
    all = await lines();
    assert.match(all.at(-1).text, /^上一句：收到：.*先说一句/s, "the model no longer sees what was taken back");
    const slow = say({ text: "慢慢说" });
    await sleep(800);
    assert.deepEqual(await take(all.at(-1).id), { status: 400, data: { error: "它还在说，等它说完" } });
    await slow;
    assert.equal((await web("/web/take-back", "wrong", { id: "x" })).status, 401);
  });
}

if (phase === "residents") {
  await fetch(`${MOCK}/__reset`);
  const KEY = "test-web-key";
  const json = async (path, body) => {
    const response = await web(path, KEY, body);
    return { status: response.status, data: await response.json().catch(() => null) };
  };
  const ids = async () => (await json("/web/residents")).data.residents.map((r) => r.id);
  const messages = async (prefix = "") => (await json(`${prefix}/web/messages`)).data.data;
  const field = async (prefix, key) => (await json(`${prefix}/web/config`)).data.fields.find((f) => f.key === key);
  const update = (text, messageId) => ({
    update_id: messageId,
    message: { message_id: messageId, date: Math.floor(Date.now() / 1000), text, from: { id: 42, is_bot: false, username: "her_test", first_name: "Her" },
      chat: { id: 42, type: "private", username: "her_test", first_name: "Her" } }
  });
  const toBot = (prefix, secret, text) =>
    fetch(`${WORKER}${prefix}/messengers/telegram/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify(update(text, nextId++))
    });

  await step("at first there is only the default resident, and no address under /r/ answers", async () => {
    assert.deepEqual(await ids(), ["default"]);
    assert.equal((await json("/web/residents")).data.max, 8);
    assert.equal((await web("/r/mochi/web/check", KEY)).status, 404);
    assert.equal((await fetch(`${WORKER}/r/mochi/avatar/${"0".repeat(32)}`)).status, 404);
    assert.equal((await web("/web/residents", "wrong")).status, 401);
  });

  await step("a new resident needs a proper id, not default, and is listed with its name", async () => {
    assert.match((await json("/web/residents", { id: "Zhi Lai" })).data.error, /小写英文字母/);
    assert.match((await json("/web/residents", { id: "default" })).data.error, /第一个住户/);
    assert.match((await json("/web/residents", { id: "mochi", name: "名".repeat(21) })).data.error, /20/);
    const added = await json("/web/residents", { id: "mochi", name: "麻薯" });
    assert.equal(added.status, 200);
    assert.deepEqual(added.data.residents.map((r) => [r.id, r.name]), [["default", "住户"], ["mochi", "麻薯"]]);
    assert.match((await json("/web/residents", { id: "mochi" })).data.error, /已经有/);
    const check = await json("/r/mochi/web/check");
    assert.equal(check.status, 200);
    assert.equal(check.data.id, "mochi");
    assert.equal(check.data.name, "麻薯");
    assert.equal((await json("/web/check")).data.name, "住户", "the default one keeps its name");
  });

  await step("/r/<id> opens the one web page on it, and the hands' script is the one script", async () => {
    const page = await fetch(`${WORKER}/r/mochi`, { redirect: "manual" });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get("location"), `${WORKER}/?r=mochi`);
    const hands = await fetch(`${WORKER}/r/mochi/hands.mjs`, { redirect: "manual" });
    assert.equal(hands.headers.get("location"), `${WORKER}/hands.mjs`);
  });

  await step("its own settings: no bot, WeCom app or check-ins of the default one's, its id as its Aelios identity and space", async () => {
    assert.equal((await field("/r/mochi", "TG_BOT_TOKEN")).workerHas, false);
    assert.equal((await field("", "TG_BOT_TOKEN")).workerHas, true, "the default one still has the Worker's bot");
    assert.equal((await field("/r/mochi", "AELIOS_IDENTITY")).fromWorker, "mochi");
    assert.equal((await field("/r/mochi", "AELIOS_NAMESPACE")).fromWorker, "mochi");
    assert.equal((await field("", "AELIOS_NAMESPACE")).fromWorker, "test-space");
    assert.equal((await field("/r/mochi", "HEARTBEAT")).fromWorker, "0", "it does not check in until told to");
    assert.equal((await field("/r/mochi", "TG_ALLOWED")).fromWorker, "@her_test", "who she is stays shared");
    assert.equal((await field("/r/mochi", "TIME_ZONE")).fromWorker, "Asia/Shanghai");
    assert.equal((await json("/r/mochi/web/config")).data.telegram.from, null);
    await json("/r/mochi/web/models");
    assert.equal((await log()).filter((e) => e.kind === "aelios.models").at(-1).identity, "mochi");
    assert.equal((await json("/r/mochi/web/config", { key: "AELIOS_IDENTITY", text: "mochi2" })).status, 200);
    assert.equal((await field("/r/mochi", "AELIOS_NAMESPACE")).fromWorker, "mochi2", "the space follows a saved identity");
    assert.equal((await json("/r/mochi/web/config", { key: "AELIOS_IDENTITY", text: "" })).status, 200);
  });

  await step("its conversation is its own, and the sidebar learns when it last said something", async () => {
    const said = await json("/r/mochi/web/say", { text: "你好麻薯" });
    assert.deepEqual(said.data, { status: "completed" });
    const own = await messages("/r/mochi");
    assert.deepEqual(own.map((line) => line.role), ["user", "assistant"]);
    assert.match(own[0].text, /你好麻薯/);
    assert.equal((await messages()).length, 0, "nothing on the default one");
    const found = (await json(`/r/mochi/web/search?q=${encodeURIComponent("麻薯")}`)).data;
    assert.ok(found.results.some((hit) => hit.role === "user"), JSON.stringify(found));
    assert.deepEqual((await json(`/web/search?q=${encodeURIComponent("麻薯")}`)).data, { results: [], next: null }, "searched on its own conversation only");
    const list = (await json("/web/residents")).data.residents;
    assert.ok(list.find((r) => r.id === "mochi").saidAt > Date.now() - 60000);
    assert.equal(list.find((r) => r.id === "default").saidAt, 0);
  });

  await step("its own Telegram bot, pointed at its own address; the default bot's secret does not open it", async () => {
    const token = "7654321:mochi-token-abcdefghijklmnopqrstuvwxyz0123";
    const saved = await json("/r/mochi/web/config", { key: "TG_BOT_TOKEN", text: token });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.telegram.here, true);
    const hook = (await log()).filter((e) => e.kind === "tg.setWebhook" && e.token === token).at(-1);
    assert.equal(hook.body.url, `${WORKER}/r/mochi/messengers/telegram/webhook`);
    await sleep(2500);
    assert.equal((await toBot("/r/mochi", SECRET, "冒充")).status, 401);
    const before = (await log()).filter((e) => e.kind === "tg.sendMessage").length;
    assert.equal((await toBot("/r/mochi", hook.body.secret_token, "在吗麻薯")).status, 200);
    const start = Date.now();
    let replies = [];
    while (Date.now() - start < 20000) {
      replies = (await log()).filter((e) => e.kind === "tg.sendMessage").slice(before);
      if (replies.length >= 2) break;
      await sleep(300);
    }
    assert.ok(replies.length >= 2, JSON.stringify(replies));
    assert.ok(replies.every((e) => e.token === token), "answered on its own bot");
    assert.match(plain(replies[0].body.text), /在吗麻薯/);
    assert.equal((await messages()).length, 0, "the default one heard nothing");
  });

  await step("its avatar and stickers are under its own address", async () => {
    const upload = await fetch(`${WORKER}/r/mochi/web/avatar`, { method: "POST", headers: { "x-web-key": KEY, "content-type": "image/png" }, body: PNG });
    const avatar = (await upload.json()).avatar;
    assert.match(avatar, /^\/r\/mochi\/avatar\/[0-9a-f]{32}$/);
    assert.equal((await fetch(`${WORKER}${avatar}`)).status, 200);
    assert.equal((await fetch(`${WORKER}${avatar.replace("/r/mochi", "")}`)).status, 404, "not the default one's");
    assert.equal((await json("/web/residents")).data.residents.find((r) => r.id === "mochi").avatar, avatar);
  });

  await step("one push key and one device list for the whole site: a device that turned it on once gets every resident's", async () => {
    const first = (await json("/web/push")).data.publicKey;
    assert.ok(first);
    assert.equal((await json("/r/mochi/web/push")).data.publicKey, first);
    const point = crypto.createECDH("prime256v1");
    point.generateKeys();
    const subscription = { endpoint: "https://push.invalid/device-1", keys: { p256dh: point.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") } };
    assert.equal((await json("/web/push/subscribe", { subscription })).data.devices, 1, "turned on while the default one was open");
    assert.equal((await json("/r/mochi/web/push")).data.devices, 1, "the other resident sees the same device");
    const tried = (await json("/r/mochi/web/push/test", {})).data;
    const left = (await json("/web/push")).data.devices;
    assert.equal(tried.sent + tried.failed.length + (1 - left), 1, `the other resident pushed to it: ${JSON.stringify(tried)}`);
    if (left) assert.equal((await json("/r/mochi/web/push/unsubscribe", { endpoint: subscription.endpoint })).data.devices, 0);
    assert.equal((await json("/web/push")).data.devices, 0, "turned off from either page, it is off for the site");
  });

  await step("its task reports and MCP sign-ins come back to its own address", async () => {
    const tasks = (await json("/r/mochi/web/tasks")).data;
    assert.equal(tasks.origin, `${WORKER}/r/mochi`);
    assert.equal((await json("/web/tasks")).data.origin, WORKER);
  });

  await step("at most 8 besides the default one", async () => {
    for (let i = 2; i <= 8; i += 1) assert.equal((await json("/web/residents", { id: `r${i}` })).status, 200);
    assert.match((await json("/web/residents", { id: "r9" })).data.error, /最多/);
    for (let i = 2; i <= 8; i += 1) assert.equal((await json("/web/residents/remove", { id: `r${i}` })).status, 200);
  });

  await step("deleted: off the list, its addresses gone, its bot let go; added again it starts empty", async () => {
    assert.equal((await json("/web/residents/remove", { id: "nobody" })).status, 404);
    assert.equal((await json("/web/residents/remove", { id: "default" })).status, 404, "the default one is never deleted");
    const removed = await json("/web/residents/remove", { id: "mochi" });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.data.residents.map((r) => r.id), ["default"]);
    assert.equal((await web("/r/mochi/web/check", KEY)).status, 404);
    assert.ok((await log()).some((e) => e.kind === "tg.deleteWebhook" && e.token === "7654321:mochi-token-abcdefghijklmnopqrstuvwxyz0123"));
    assert.equal((await json("/web/residents", { id: "mochi" })).status, 200);
    assert.equal((await messages("/r/mochi")).length, 0);
    assert.equal((await json("/r/mochi/web/config")).data.telegram.from, null);
    assert.equal((await json("/r/mochi/web/check")).data.avatar, null);
    assert.equal((await json("/web/check")).data.id, "default");
  });

  await step("while it is being deleted its id stays taken and its addresses are gone; free again once it is wiped", async () => {
    assert.equal((await json("/r/mochi/web/config", { key: "RESIDENT_NAME", text: "旧的" })).status, 200);
    assert.equal((await json("/r/mochi/web/config", { key: "TG_BOT_TOKEN", text: "7654321:mochi-token-abcdefghijklmnopqrstuvwxyz0123" })).status, 200);
    await sleep(1500); // a new bot token starts the resident again a second later
    await fetch(`${MOCK}/__faults`, { method: "POST", body: JSON.stringify({ slowDeleteWebhook: 1500 }) });
    try {
      const removing = json("/web/residents/remove", { id: "mochi" });
      await sleep(400);
      assert.match((await json("/web/residents", { id: "mochi", name: "新的" })).data.error, /还在删/);
      assert.deepEqual(await ids(), ["default"], "off the list at once");
      assert.equal((await web("/r/mochi/web/check", KEY)).status, 404);
      assert.equal((await removing).status, 200);
    } finally {
      await fetch(`${MOCK}/__faults`, { method: "POST", body: JSON.stringify({ slowDeleteWebhook: 0 }) });
    }
    assert.equal((await json("/web/residents", { id: "mochi", name: "新的" })).status, 200);
    const check = await json("/r/mochi/web/check");
    assert.equal(check.data.name, "新的", "nothing of the old one");
    assert.equal((await json("/r/mochi/web/config")).data.telegram.from, null);
  });
}


if (phase === "group") {
  await fetch(`${MOCK}/__reset`);
  const KEY = "test-web-key";
  const json = async (path, body) => {
    const response = await web(path, KEY, body);
    return { status: response.status, data: await response.json().catch(() => null) };
  };
  const make = async (body) => {
    const { status, data } = await json("/web/groups", body);
    assert.equal(status, 200, JSON.stringify(data));
    return data.group;
  };
  let g = "";
  const room = async (prefix = "", id = g) => (await json(`${prefix}/web/group?g=${id}`)).data;
  // Until the round is over; the lines after `after`, as "author: text" (her lines with no author).
  const settled = async (after = 0, ms = 20000) => {
    const start = Date.now();
    for (;;) {
      const now = await room();
      if (!now.running && !now.speaking) return now.lines.filter((l) => l.seq > after).map((l) => `${l.kind === "note" ? "note" : l.author || "her"}: ${l.text}`);
      if (Date.now() - start > ms) throw new Error(`the round did not end: ${JSON.stringify(now)}`);
      await sleep(300);
    }
  };
  const say = async (what) => {
    const { status, data } = await json(`/web/group/say?g=${g}`, typeof what === "string" ? { text: what } : what);
    assert.equal(status, 200, JSON.stringify(data));
    return data.line.seq - 1;
  };
  const own = async (prefix) => (await json(`${prefix}/web/messages`)).data.data;

  await step("groups: at least two residents, made and listed, the same from every resident's page, checked", async () => {
    assert.deepEqual((await json("/web/groups")).data, { groups: [] });
    assert.equal((await web("/web/groups", "wrong")).status, 401);
    assert.match((await json("/web/groups", { members: ["default"] })).data.error, /至少要两个住户/);
    assert.equal((await json("/web/residents", { id: "mochi", name: "麻薯" })).status, 200);
    assert.equal((await json("/web/residents", { id: "kiki", name: "Kiki" })).status, 200);
    assert.equal((await json("/web/groups", { members: ["default", "nobody"] })).status, 400);
    const home = await make({ members: ["mochi", "default"] });
    assert.deepEqual([home.name, home.members, home.reply, home.order], ["住户、麻薯", ["default", "mochi"], "all", "list"], "named after its members; who answers has defaults");
    const weekend = await make({ name: "周末", members: ["mochi", "kiki"] });
    g = home.id;
    const listed = (await json("/r/kiki/web/groups")).data.groups;
    assert.deepEqual(listed.map((group) => [group.name, group.members]), [["住户、麻薯", ["default", "mochi"]], ["周末", ["mochi", "kiki"]]]);
    assert.equal((await room("", weekend.id)).lines.length, 0);
    assert.equal((await json(`/web/group/say?g=${g}`, { text: "  " })).status, 400);
    assert.equal((await json(`/web/group/say?g=${g}`, { text: "长".repeat(4001) })).status, 400);
    assert.match((await json("/web/group/say?g=gnothere", { text: "在吗" })).data.error, /没有这个群/);
  });

  await step("a message of hers: the group's members answer in order, each hearing the ones before; not on Telegram", async () => {
    const before = (await sent()).length;
    const after = await say("今晚吃什么");
    assert.deepEqual(await settled(after), ["her: 今晚吃什么", "default: 住户听到了：[them] 今晚吃什么", "mochi: 麻薯听到了：[them] 今晚吃什么 / [住户] 住户听到了：[them] 今晚吃什么"]);
    assert.equal((await room("/r/kiki")).lines.length, 3, "the same group from another resident's page");
    assert.equal((await sent()).length, before, "nothing went to Telegram");
  });

  await step("what is said in a group goes into each member's own conversation, not shown in its chat, and is counted as the group's", async () => {
    assert.deepEqual(await own(""), [], "its chat shows none of it");
    assert.deepEqual(await own("/r/mochi"), []);
    const heard = (await json(`/r/mochi/web/search?q=${encodeURIComponent("今晚吃什么")}`)).data.results;
    assert.deepEqual(heard.map((hit) => hit.role), ["assistant", "user"], "what it was handed and its answer are in its conversation");
    assert.deepEqual((await json(`/r/kiki/web/search?q=${encodeURIComponent("今晚吃什么")}`)).data.results, [], "not in the group, not handed anything");
    const rows = (await json("/r/mochi/web/usage")).data.rows;
    assert.ok(rows.length > 0 && rows.every((row) => row.kind === "group" && row.via === "web"), JSON.stringify(rows.slice(0, 2)));
    const found = (await json(`/r/mochi/web/search?q=${encodeURIComponent("group chat")}`)).data;
    assert.deepEqual(found.results, [], "the head it was handed is not searched");
  });

  await step("@ calls only those named, and one called later is handed what it missed; passing says nothing", async () => {
    let after = await say("@麻薯 你呢");
    assert.deepEqual(await settled(after), ["her: @麻薯 你呢", "mochi: 麻薯听到了：[them] @麻薯 你呢"], "it had heard the rest");
    after = await say("@住户 只叫你");
    const [, called] = await settled(after);
    assert.equal(called, "default: 住户听到了：[them] @麻薯 你呢 / [麻薯] 麻薯听到了：[them] @麻薯 你呢 / [them] @住户 只叫你");
    after = await say("@Kiki 你在吗");
    assert.deepEqual(await settled(after), ["her: @Kiki 你在吗"], "not in the group, not called");
    after = await say("都别说话");
    assert.deepEqual(await settled(after), ["her: 都别说话"], "both passed");
  });

  await step("the settings: renamed, a member added (handed the group so far), one answering in turn; checked", async () => {
    const set = (body) => json(`/web/group/config?g=${g}`, { name: "小家", members: ["default", "mochi", "kiki"], reply: "one", order: "list", ...body });
    assert.equal((await set({ members: ["kiki"] })).status, 400);
    assert.equal((await set({ reply: "some" })).status, 400);
    const { data } = await set({});
    assert.deepEqual([data.group.name, data.group.members, data.group.reply], ["小家", ["default", "mochi", "kiki"], "one"]);
    let after = await say("轮到谁");
    const first = await settled(after);
    assert.match(first[1], /^kiki: Kiki听到了：\[them\] 今晚吃什么 \/ .* \/ \[them\] 都别说话 \/ \[them\] 轮到谁$/, "the newcomer, who has said least, hears the group so far");
    after = (await room()).lines.at(-1).seq;
    await say("再轮一个");
    const second = await settled(after);
    assert.equal(second.length, 2, second.join("\n"));
    assert.notEqual(second[1].split(":")[0], "kiki", "one in turn");
  });

  await step("stop: no one else answers, the one answering finishes; her next message is answered", async () => {
    await json(`/web/group/config?g=${g}`, { name: "小家", members: ["default", "mochi"], reply: "all", order: "list" });
    const after = await say("大家慢慢说");
    const start = Date.now();
    while (!(await room()).speaking && Date.now() - start < 5000) await sleep(100);
    await sleep(1500);
    assert.deepEqual(await own(""), [], "an answer being written for the group is not shown in its chat either");
    assert.deepEqual((await json(`/web/group/stop?g=${g}`, {})).data, { ok: true });
    assert.deepEqual(await settled(after), ["her: 大家慢慢说", "note: 你让大家先停一下。", "default: 住户慢慢说完了"]);
    const again = await say("继续吧");
    const next = await settled(again);
    assert.equal(next.length, 3, `the next message is answered: ${next.join(" / ")}`);
    assert.match(next[2], /^mochi: 麻薯听到了：\[them\] 大家慢慢说 \/ \[住户\] 住户慢慢说完了 \/ \[them\] 继续吧 \/ /, "the one stopped hears what it missed");
  });

  await step("rounds: after everyone has had a turn they go round again while someone has something to say, up to the setting", async () => {
    let after = await say("接着聊");
    let lines = await settled(after);
    assert.equal(lines.length, 7, lines.join("\n"));
    assert.deepEqual(lines.slice(1).map((l) => l.match(/^(\w+): \S+?(第 \d 轮)?听到了/)?.slice(1, 3).join(" ")), ["default ", "mochi ", "default 第 2 轮", "mochi 第 2 轮", "default 第 3 轮", "mochi 第 3 轮"], "told which round it is");
    assert.equal((await json(`/web/group/config?g=${g}`, { name: "小家", members: ["default", "mochi"], rounds: 1 })).data.group.rounds, 1);
    after = await say("接着聊");
    lines = await settled(after);
    assert.equal(lines.length, 3, "one round");
    assert.equal((await json(`/web/group/config?g=${g}`, { name: "小家", members: ["default", "mochi"], rounds: 9 })).status, 400);
    await json(`/web/group/config?g=${g}`, { name: "小家", members: ["default", "mochi"] });
  });

  await step("pictures and stickers: hers shown and handed to each member with the pictures; a member's sticker shown", async () => {
    let after = await say({ text: "看图", pictures: [{ data: PNG.toString("base64") }] });
    let lines = await settled(after);
    assert.equal(lines.length, 3, lines.join("\n"));
    assert.match(lines[1], /^default: 住户听到了：.* \/ \[them\] 看图 \[picture\]（看到 1 张图）$/, "the picture is marked where it was, and goes with it");
    assert.match(lines[2], /^mochi: 麻薯听到了：\[them\] 看图 \[picture\] \/ \[住户\] .*（看到 1 张图）$/);
    const sent = (await room()).lines.find((l) => l.seq === after + 1);
    assert.deepEqual([sent.text, sent.pictures, JSON.stringify(sent).includes("key")], ["看图", 1, false]);
    const picture = await web(`/web/group/picture?g=${g}&seq=${sent.seq}&n=0`, KEY);
    assert.deepEqual([picture.status, picture.headers.get("content-type"), picture.headers.get("content-security-policy")], [200, "image/png", "sandbox"]);
    assert.equal((await web(`/web/group/picture?g=${g}&seq=${sent.seq}&n=0`, "wrong")).status, 401);
    assert.equal((await json(`/web/group/say?g=${g}`, { pictures: [{ data: Buffer.from("not a picture").toString("base64") }] })).status, 400);
    const pack = zip([
      { name: "pack.json", data: JSON.stringify({ format: "resident-stickers/1", name: "Mine", stickers: [{ id: "hug", file: "hug.png", emoji: "🤗", when: "A hug." }] }), deflate: true },
      { name: "hug.png", data: PNG, deflate: true }
    ]);
    const imported = await fetch(`${WORKER}/r/mochi/web/stickers/import?name=mine.zip`, { method: "POST", headers: { "x-web-key": KEY, "content-type": "application/zip" }, body: pack });
    assert.equal(imported.status, 200, await imported.clone().text());
    const [packView] = (await json("/r/mochi/web/stickers")).data.packs;
    const hug = packView.stickers[0];
    after = await say({ sticker: { from: "mochi", key: hug.key } });
    lines = await settled(after);
    assert.deepEqual(lines.slice(0, 2), ["her: ", "default: 住户听到了：[them] [sticker 🤗 A hug.]"], "read as what it means");
    const stuck = (await room()).lines.find((l) => l.seq === after + 1);
    assert.deepEqual(stuck.stickers, [{ url: `/r/mochi/stickers/${hug.key}`, video: false, mark: "[sticker 🤗 A hug.]" }]);
    assert.equal((await json(`/web/group/say?g=${g}`, { sticker: { from: "default", key: hug.key } })).status, 400, "only a sticker of the resident named");
    after = await say(`@麻薯 发表情 ${packView.id}/${hug.name}`);
    await settled(after);
    const reply = (await room()).lines.find((l) => l.seq > after + 1 && l.author === "mochi");
    assert.deepEqual([reply.text, reply.stickers], ["", [{ url: `/r/mochi/stickers/${hug.key}`, video: false, mark: "[sticker 🤗 A hug.]" }]], "a sticker alone is a reply");
    assert.equal((await json("/r/mochi/web/stickers/pack", { id: packView.id, on: false })).status, 200);
    after = await say(`@麻薯 发表情 ${packView.id}/${hug.name}`);
    await settled(after);
    assert.deepEqual((await room()).lines.filter((l) => l.seq > after + 1 && l.author === "mochi"), [], "its pack off: the sticker does not go, and a reply of nothing else passes");
    await json("/r/mochi/web/stickers/pack", { id: packView.id, on: true });
  });

  await step("a group's icon: put up and taken down from the settings, public like an avatar, only while it is one", async () => {
    const put = await fetch(`${WORKER}/web/group/icon?g=${g}`, { method: "POST", headers: { "x-web-key": KEY, "content-type": "image/png" }, body: PNG });
    const icon = (await put.json()).groups.find((group) => group.id === g).icon;
    assert.match(icon, /^\/avatar\/[0-9a-f]{32}$/);
    assert.equal((await fetch(`${WORKER}${icon}`)).status, 200);
    assert.equal((await fetch(`${WORKER}/r/mochi${icon}`)).status, 404, "the first resident's, not another's");
    const bad = await fetch(`${WORKER}/web/group/icon?g=${g}`, { method: "POST", headers: { "x-web-key": KEY, "content-type": "text/plain" }, body: "no" });
    assert.equal(bad.status, 400);
    assert.equal((await json(`/web/group/icon/remove?g=${g}`, {})).data.groups.find((group) => group.id === g).icon, null);
    assert.equal((await fetch(`${WORKER}${icon}`)).status, 404);
  });

  await step("a member on Aelios: its turn goes through Aelios as one of hers, recalled for and recorded", async () => {
    assert.equal((await json("/r/mochi/web/model", { text: "chatgpt/gpt-5" })).status, 200);
    const after = await say("@麻薯 记得吗");
    const lines = await settled(after);
    assert.match(lines[1], /^mochi: Aelios（chatgpt\/gpt-5）收到：/);
    const turn = (await log()).filter((e) => e.kind === "aelios.chat" && e.identity === "mochi").at(-1);
    assert.equal(turn.purpose, null, "not auxiliary");
    assert.match(JSON.stringify(turn.body.messages.at(-1)), /group chat \\"小家\\".*@麻薯 记得吗/);
  });

  await step("a group goes with what was said in it; what its members heard stays in their own chats", async () => {
    const left = (await json(`/web/group/remove?g=${g}`, {})).data.groups;
    assert.deepEqual(left.map((group) => group.name), ["周末"]);
    assert.match((await room()).error, /没有这个群/);
    assert.ok((await json(`/r/mochi/web/search?q=${encodeURIComponent("今晚吃什么")}`)).data.results.length > 0);
  });
}
