// The Worker in front of the resident:
//   POST /messengers/telegram/webhook   Telegram → secret check, allowlist, slash commands → the resident
//   GET|POST /messengers/wecom/webhook  WeCom: GET checks the address once; POST is a message, opened and checked by
//                                       the resident (wecom.ts) with the settings in effect
//   GET  /tg/setup?secret=…             points the bot's webhook here, for a TG_WEBHOOK_SECRET set in Cloudflare
//                                       (POST with the x-tg-setup-secret header works too, for scripts); over
//                                       https also makes the bot's menu button open the web page as a Mini App.
//                                       A bot token saved on the settings page is connected from there instead
//   /web/*                              the web page's API (same conversation as Telegram, the model, the persona,
//                                       the settings and the usage timeline), behind WEB_KEY, or inside Telegram behind signed
//                                       initData / a Mini App session and TG_ALLOWED (mini-app.ts); /web/search finds
//                                       words in the whole conversation (chat-search.ts); /web/groups and /web/group
//                                       are the group chats, the same on every resident's page (group.ts)
//   GET  /mcp/callback?code=…&state=…   where an MCP server's OAuth sign-in comes back to (mcp-servers.ts)
//   GET  /stickers/<key>                a sticker's picture for the web page (stickers.ts); the key is long and random
//   GET  /avatar/<key>                  the resident's avatar, put up on the web page (public, like a sticker)
//   GET  /manifest.webmanifest          the web page as an app for the home screen, with the resident's name and avatar
//   POST /runner/v1/pair|heartbeat|poll|receipt   the paired machine's runner (machine.ts, runner/PROTOCOL.md):
//                                       pairing with a code from the settings page, then its own token as Bearer
//   POST /tasks/<id>/progress|result    a GitHub Actions run or a cloud Claude Code session reporting on its task
//                                       (cloud-tasks.ts), with the task's one-time code in x-task-code
//   POST /tasks/<id>/hands              a GitHub Actions run asking for the GitHub token (code in x-task-code)
//   POST /tasks/<id>/model/chat/completions   its model calls, OpenAI format, the code as Bearer (hands-repo.ts)
//   POST /tasks/<id>/files?path=<path>  a file the run made for them, the bytes as the body (code in x-task-code)
//   everything else                     the web page itself (public/)
//
// More than one resident (residents.ts): every address above under /r/<id> is that resident's, the same as the
// default one's without it, and /r/<id> itself opens the web page on it (/?r=<id>). /web/residents lists, adds and
// deletes them.

import { getAgentByName } from "agents";
import { machineReply, readMachineJson } from "./machine";
import { callerAllowed, issueSession, miniAppCaller, triesMiniApp } from "./mini-app";
import { MCP_CALLBACK_PATH } from "./mcp-servers";
import { MAX_ZIP_BYTES } from "./stickers";
import { REPORT_MAX_BYTES } from "./cloud-tasks";
import { THREAD_FILE_MAX } from "./task-worker";
import { TELEGRAM_WEBHOOK_PATH, commandOf, isAllowed, timingSafeEqual, type TelegramUpdate } from "./telegram";
import { DEFAULT_RESIDENT, RESIDENTS_MAX, residentOfPath, residentPrefix } from "./residents";

export { ThinkMessengerStateAgent } from "@cloudflare/think/messengers";
export { Resident } from "./resident";
export { ClaudeBox } from "./claude-box";
export { TaskWorker } from "./task-worker";

const WECOM_PATH = "/messengers/wecom/webhook";
// A thread goes by its first task's id (cloud-tasks.ts).
const THREAD_ID = /^t_[0-9a-f]{10}$/;
// A WeCom push is a few kilobytes of XML.
const WECOM_MAX_BYTES = 64 * 1024;
// The first resident; the others are found by their ids (residents.ts).
const AGENT_NAME = DEFAULT_RESIDENT;
// A message from the web page with four pictures and a voice message, in base64; any other call is small.
const SAY_MAX_BYTES = 24 * 1024 * 1024;
const JSON_MAX_BYTES = 1024 * 1024;
// A model call from the hands carries the whole run so far: 30 steps of bounded tool output fit well under this.
const HANDS_MODEL_MAX_BYTES = 4 * 1024 * 1024;
const AVATAR_UPLOAD_MAX = 512 * 1024;

/** A file of hers the web page reads and shows itself: never run as a page of this origin, never kept by caches. */
function privateFile(type: string): HeadersInit {
  return {
    "content-type": type,
    "content-security-policy": "sandbox",
    "x-content-type-options": "nosniff",
    "cache-control": "private, max-age=86400"
  };
}

/** Which resident a request is for, and that resident's own address (origin plus /r/<id>). */
type At = { id: string; base: string };

const residentOf = (env: Env, at: At) => getAgentByName(env.RESIDENT, at.id);

/** What makes the web page an app to put on the home screen: its name and icon follow the resident's. */
async function manifest(env: Env): Promise<Response> {
  const { name, avatar } = await (await getAgentByName(env.RESIDENT, AGENT_NAME)).webIdentity();
  const icons = [
    ...(avatar ? [{ src: avatar, sizes: "512x512", purpose: "any" }] : []),
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: avatar ? "maskable" : "any maskable" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: avatar ? "maskable" : "any maskable" }
  ];
  return Response.json(
    { name, short_name: name, start_url: "/", scope: "/", display: "standalone", background_color: "#070a16", theme_color: "#070a16", icons },
    { headers: { "content-type": "application/manifest+json", "cache-control": "no-cache" } }
  );
}

async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext, url: URL, at: At): Promise<Response> {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  const got = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!got) return new Response("unauthorized", { status: 401 });
  // The token and the webhook secret can be on the settings page, so the resident checks them.
  const agent = await residentOf(env, at);
  if (!(await agent.telegramGate(got))) return new Response("unauthorized", { status: 401 });

  const body = await request.text();
  let update: TelegramUpdate;
  try {
    update = JSON.parse(body);
  } catch {
    return new Response("bad request", { status: 400 });
  }
  const message = update.message;
  const chatId = message?.chat?.id;
  // Anything that is not a private message from a person is acknowledged and dropped.
  if (!message || chatId == null || message.from?.is_bot || message.chat?.type !== "private") {
    return new Response("ok");
  }
  // TG_ALLOWED can be set on the settings page, so the resident says what is in effect.
  if (!isAllowed(await agent.telegramAllowed(), String(chatId), message.from?.username)) {
    // No reply, so strangers cannot probe the bot. The log line shows what to put in TG_ALLOWED.
    console.log("tg: dropped message from a chat not in TG_ALLOWED", { chatId, username: message.from?.username });
    return new Response("ok");
  }

  const command = commandOf(message.text);
  if (command) {
    // The Think messenger ignores slash commands; the Worker answers them without a model turn.
    ctx.waitUntil(agent.telegramCommand(command, String(chatId)).catch((error) => console.error("tg: command failed", { command, error: String(error) })));
    return new Response("ok");
  }
  return agent.fetch(new Request(url.href, { method: "POST", headers: request.headers, body }));
}

/** WeCom: its address check (GET) answered by the resident, a message (POST) handed to it as it came. */
async function handleWecom(request: Request, env: Env, url: URL, at: At): Promise<Response> {
  const agent = await residentOf(env, at);
  if (request.method === "GET") {
    const answer = await agent.wecomVerify(url.search);
    return new Response(answer.body, { status: answer.status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (Number(request.headers.get("content-length") ?? 0) > WECOM_MAX_BYTES) return new Response("too large", { status: 413 });
  const body = await request.text();
  if (body.length > WECOM_MAX_BYTES) return new Response("too large", { status: 413 });
  // Only the address and the body go in, never the caller's other headers.
  return agent.fetch(new Request(url.href, { method: "POST", headers: { "content-type": "text/xml" }, body }));
}

async function handleSetup(request: Request, env: Env, url: URL, at: At): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { ...headers, allow: "GET, POST" } });
  }
  // Opened in a browser the secret is in the address; a script can send it as a header instead.
  const given = request.headers.get("x-tg-setup-secret") ?? url.searchParams.get("secret") ?? "";
  const answer = await (await residentOf(env, at)).telegramSetup(given, at.base);
  return new Response(answer.text, { status: answer.status, headers: { ...headers, "content-type": answer.json ? "application/json" : "text/plain; charset=utf-8" } });
}

/** The web door is open only with WEB_KEY, sent by the page as the x-web-key header. */
function webAllowed(env: Env, request: Request): boolean {
  const key = env.WEB_KEY?.trim();
  return Boolean(key && timingSafeEqual(request.headers.get("x-web-key") ?? "", key));
}

type WebCaller = { via: "web" } | { via: "telegram"; caller: NonNullable<Awaited<ReturnType<typeof miniAppCaller>>> };

/**
 * WEB_KEY, or else the Mini App's signed initData or session token from someone in TG_ALLOWED (checked on every
 * request, so taking someone off the list shuts them out at once). Null when neither.
 */
async function webCaller(env: Env, request: Request, at: At): Promise<WebCaller | null> {
  if (webAllowed(env, request)) return { via: "web" };
  if (!triesMiniApp(request)) return null;
  // The bot token can be on the settings page: the resident says which one is in effect. Each resident's own bot
  // opens the web page on that resident.
  const agent = await residentOf(env, at);
  const caller = await miniAppCaller(request, await agent.telegramToken());
  if (!caller) return null;
  if (!callerAllowed(await agent.telegramAllowed(), caller)) {
    console.log("web: Mini App user not in TG_ALLOWED", { id: caller.user.id, username: caller.user.username });
    return null;
  }
  return { via: "telegram", caller };
}

/** Every resident for the sidebar, the default one first: its id, name, avatar and when it last said something. */
async function residentList(env: Env): Promise<{ residents: { id: string; name: string; avatar: string | null; saidAt: number }[]; max: number }> {
  const ids = [AGENT_NAME, ...(await (await getAgentByName(env.RESIDENT, AGENT_NAME)).residentIds())];
  const residents = await Promise.all(
    ids.map(async (id) => {
      const agent = await getAgentByName(env.RESIDENT, id);
      const [identity, saidAt] = await Promise.all([agent.webIdentity(), agent.saidAt()]);
      return { ...identity, saidAt };
    })
  );
  return { residents, max: RESIDENTS_MAX };
}

/**
 * The residents (residents.ts): listed, added (with a name to start with) and deleted, with the web door key only.
 * The list is the default resident's, whichever resident's page asks.
 */
async function handleResidents(request: Request, env: Env, url: URL, who: WebCaller): Promise<Response> {
  if (who.via !== "web") return Response.json({ error: "用网页钥匙进门才能管住户" }, { status: 403 });
  if (request.method === "POST") {
    if (Number(request.headers.get("content-length") ?? 0) > JSON_MAX_BYTES) return Response.json({ error: "发的东西太大了" }, { status: 413 });
    const body = (await request.json().catch(() => ({}))) as { id?: unknown; name?: unknown };
    const id = String(body.id ?? "").trim();
    const first = await getAgentByName(env.RESIDENT, AGENT_NAME);
    if (url.pathname === "/web/residents/remove") {
      const removed = await first.residentRemove(id);
      if ("error" in removed) return Response.json({ error: removed.error }, { status: removed.status });
    } else if (url.pathname === "/web/residents") {
      const name = String(body.name ?? "").trim();
      if (name.length > 20) return Response.json({ error: "名字最多 20 个字" }, { status: 400 });
      const added = await first.residentAdd(id);
      if ("error" in added) return Response.json(added, { status: 400 });
      if (name) await (await getAgentByName(env.RESIDENT, id)).webSetConfig("RESIDENT_NAME", name);
    } else return new Response("not found", { status: 404 });
  } else if (request.method !== "GET" || url.pathname !== "/web/residents") {
    return new Response("method not allowed", { status: 405 });
  }
  return Response.json(await residentList(env), { headers: { "cache-control": "no-store" } });
}

/** Group chats (group.ts): the same whichever resident's page asks, since they live in the default resident. */
async function handleGroup(request: Request, env: Env, url: URL): Promise<Response> {
  const room = await getAgentByName(env.RESIDENT, AGENT_NAME);
  const answer = (data: object) => Response.json(data, { status: "error" in data ? 400 : 200, headers: { "cache-control": "no-store" } });
  if (request.method === "GET" && url.pathname === "/web/groups") return answer(await room.webGroups());
  const id = url.searchParams.get("g") ?? "";
  if (request.method === "GET" && url.pathname === "/web/group") {
    const at = (key: string) => (url.searchParams.has(key) && Number.isSafeInteger(Number(url.searchParams.get(key))) ? Number(url.searchParams.get(key)) : null);
    return answer(await room.webGroup(id, at("after"), at("before")));
  }
  if (request.method === "GET" && url.pathname === "/web/group/picture") {
    const file = await room.groupPicture(id, Number(url.searchParams.get("seq")), Number(url.searchParams.get("n") ?? 0));
    if (!file) return new Response("not found", { status: 404 });
    return new Response(file.bytes, { headers: privateFile(file.type) });
  }
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  // The icon comes as it is, like the avatar: a square the page has made small.
  if (url.pathname === "/web/group/icon") {
    if (Number(request.headers.get("content-length") ?? 0) > AVATAR_UPLOAD_MAX) return Response.json({ error: "图标太大了" }, { status: 413 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > AVATAR_UPLOAD_MAX) return Response.json({ error: "图标太大了" }, { status: 413 });
    return answer(await room.webGroupIcon(id, bytes));
  }
  // A message can carry pictures, as in the chat.
  if (Number(request.headers.get("content-length") ?? 0) > (url.pathname === "/web/group/say" ? SAY_MAX_BYTES : JSON_MAX_BYTES)) {
    return Response.json({ error: "发的东西太大了" }, { status: 413 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (url.pathname === "/web/groups") return answer(await room.webGroupCreate(body));
  if (url.pathname === "/web/group/say") return answer(await room.webGroupSay(id, body));
  if (url.pathname === "/web/group/icon/remove") return answer(await room.webGroupIconRemove(id));
  if (url.pathname === "/web/group/stop") return answer(await room.webGroupStop(id));
  if (url.pathname === "/web/group/config") return answer(await room.webGroupConfig(id, body));
  if (url.pathname === "/web/group/remove") return answer(await room.webGroupRemove(id));
  return new Response("not found", { status: 404 });
}

async function handleWeb(request: Request, env: Env, url: URL, at: At): Promise<Response> {
  const who = await webCaller(env, request, at);
  if (!who) return new Response("unauthorized", { status: 401 });
  if (url.pathname === "/web/residents" || url.pathname === "/web/residents/remove") return handleResidents(request, env, url, who);
  if (url.pathname === "/web/groups" || url.pathname === "/web/group" || url.pathname.startsWith("/web/group/")) return handleGroup(request, env, url);
  if (url.pathname === "/web/session") {
    // Only the Mini App gets sessions; WEB_KEY is used as it is.
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    if (who.via !== "telegram") return new Response("the Mini App way in only", { status: 400 });
    const { user, auth } = who.caller;
    const agent = await residentOf(env, at);
    const session = await issueSession(await agent.telegramToken(), user, auth);
    return Response.json(
      { ...session, user: { id: user.id, username: user.username ?? null, first_name: user.first_name ?? null } },
      { headers: { "cache-control": "no-store" } }
    );
  }
  const agent = await residentOf(env, at);
  // A sticker pack's zip comes as it is, its file name in ?name=.
  if (url.pathname === "/web/stickers/import" && request.method === "POST" && !/json/.test(request.headers.get("content-type") ?? "")) {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_ZIP_BYTES) return Response.json({ error: `压缩包最多 ${MAX_ZIP_BYTES / 1024 / 1024} MB` }, { status: 413 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    const saved = await agent.webImportStickerZip(bytes, (url.searchParams.get("name") ?? "").replace(/\.zip$/i, ""));
    return Response.json(saved, { status: "error" in saved ? 400 : 200 });
  }
  // The avatar comes as it is: a square the page has made small.
  if (url.pathname === "/web/avatar" && request.method === "POST") {
    if (Number(request.headers.get("content-length") ?? 0) > AVATAR_UPLOAD_MAX) return Response.json({ error: "头像太大了" }, { status: 413 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > AVATAR_UPLOAD_MAX) return Response.json({ error: "头像太大了" }, { status: 413 });
    const saved = await agent.webSetAvatar(bytes);
    return Response.json(saved, { status: "error" in saved ? 400 : 200 });
  }
  // A message can carry pictures and a voice message, in base64: larger than the other calls, but not without end.
  if (Number(request.headers.get("content-length") ?? 0) > (url.pathname === "/web/say" ? SAY_MAX_BYTES : JSON_MAX_BYTES)) {
    return Response.json({ error: "发的东西太大了" }, { status: 413 });
  }
  const body =
    request.method === "POST"
      ? ((await request.json().catch(() => ({}))) as {
          text?: string;
          key?: string;
          name?: string;
          url?: string;
          id?: string;
          on?: boolean;
          when?: string;
          emoji?: string;
          site?: string;
          host?: string;
          pictures?: { data?: string }[];
          voice?: { data?: string };
          sticker?: string;
          quote?: string;
          again?: boolean;
          subscription?: unknown;
          token?: unknown;
          previousToken?: unknown;
          endpoint?: string;
          execution?: string;
          template?: string;
          model?: string;
          label?: string;
          runnerId?: string;
        })
      : {};
  switch (`${request.method} ${url.pathname}`) {
    case "GET /web/check":
      return Response.json({ ok: true, aelios: await agent.hasMemory(), via: who.via, ...(await agent.webIdentity()) });
    case "GET /web/messages":
      // ?since=<version>: { same } while nothing has changed, without reading the conversation.
      return Response.json(await agent.webLook(url.searchParams.get("since")));
    case "GET /web/search": {
      // ?q=<words>, and ?before=<where the last page stopped> for the next page (chat-search.ts).
      const before = Number(url.searchParams.get("before"));
      const found = await agent.webChatSearch(url.searchParams.get("q") ?? "", Number.isSafeInteger(before) && before > 0 ? before : undefined);
      return Response.json(found, { status: "error" in found ? 400 : 200, headers: { "cache-control": "no-store" } });
    }
    case "GET /web/search/around": {
      const around = await agent.webChatAround(url.searchParams.get("id") ?? "");
      return Response.json(around, { status: "error" in around ? 404 : 200, headers: { "cache-control": "no-store" } });
    }
    case "POST /web/say": {
      await agent.noteOrigin(at.base);
      const said = await agent.webSay({
        text: String(body.text ?? ""),
        ...(Array.isArray(body.pictures) ? { pictures: body.pictures.map((picture) => ({ data: String(picture?.data ?? "") })) } : {}),
        ...(body.voice ? { voice: { data: String(body.voice.data ?? "") } } : {}),
        ...(body.sticker ? { sticker: String(body.sticker) } : {}),
        ...(body.quote ? { quote: String(body.quote) } : {})
      });
      return Response.json(said, { status: "error" in said ? 400 : 200 });
    }
    case "POST /web/take-back": {
      // Its latest reply deleted, or with again: true answered anew (take-back.ts).
      await agent.noteOrigin(at.base);
      const taken = await agent.webTakeBack(String(body.id ?? ""), body.again === true);
      return Response.json(taken, { status: "error" in taken ? 400 : 200 });
    }
    case "GET /web/picture": {
      // Her picture, as bytes the page shows itself: never a page of this origin.
      const n = Number(url.searchParams.get("n"));
      const picture = Number.isSafeInteger(n) && n >= 0 ? await agent.webPicture(url.searchParams.get("id") ?? "", n) : null;
      if (!picture) return new Response("not found", { status: 404 });
      return new Response(picture.bytes, { headers: privateFile(picture.type) });
    }
    case "GET /web/media": {
      const key = url.searchParams.get("key") ?? "";
      const file = /^[0-9a-f]{32}$/.test(key) ? await agent.webMedia(key) : null;
      if (!file) return new Response("not found", { status: 404 });
      return new Response(file.bytes, { headers: privateFile(file.type) });
    }
    case "GET /web/file": {
      // A file a reply handed over: bytes to save, never a page of this origin (the web page decides how to show it).
      const key = url.searchParams.get("key") ?? "";
      const bytes = /^[0-9a-f]{32}$/.test(key) ? await agent.webFile(key) : null;
      if (!bytes) return new Response("not found", { status: 404 });
      return new Response(bytes, {
        headers: { "content-type": "application/octet-stream", "content-disposition": "attachment", "content-security-policy": "sandbox", "x-content-type-options": "nosniff", "cache-control": "private, max-age=86400" }
      });
    }
    case "POST /web/speak": {
      const spoken = await agent.webSpeak(String(body.id ?? ""));
      return Response.json(spoken, { status: "error" in spoken ? 400 : 200 });
    }
    case "POST /web/command": {
      const answer = await agent.webCommand(String(body.name ?? ""));
      return Response.json(answer, { status: "error" in answer ? 400 : 200 });
    }
    case "POST /web/avatar/remove":
      return Response.json(await agent.webRemoveAvatar());
    case "POST /web/task/choose": {
      await agent.noteOrigin(at.base);
      const chosen = await agent.webChoose(String(body.id ?? ""), String(body.text ?? ""));
      return Response.json(chosen, { status: "error" in chosen ? 400 : 200 });
    }
    case "POST /web/task/settle": {
      const settled = await agent.webSettle(String(body.id ?? ""));
      return Response.json(settled, { status: "error" in settled ? 400 : 200 });
    }
    case "GET /web/push":
      return Response.json(await agent.webPush());
    case "POST /web/push/subscribe": {
      await agent.noteOrigin(at.base);
      const saved = await agent.webPushSubscribe(body.subscription);
      return Response.json(saved, { status: "error" in saved ? 400 : 200 });
    }
    case "POST /web/push/unsubscribe":
      return Response.json(await agent.webPushUnsubscribe(String(body.endpoint ?? "")));
    case "POST /web/push/native/subscribe": {
      await agent.noteOrigin(at.base);
      const saved = await agent.nativePushSubscribe(body.token, body.previousToken);
      return Response.json(saved, { status: "error" in saved ? 400 : 200 });
    }
    case "POST /web/push/native/unsubscribe": {
      const saved = await agent.nativePushUnsubscribe(body.token);
      return Response.json(saved, { status: "error" in saved ? 400 : 200 });
    }
    case "POST /web/push/test":
      return Response.json(await agent.webPushTest());
    case "POST /web/pin":
      return Response.json({ ok: await agent.webPin(String(body.text ?? "")) });
    case "GET /web/model":
      return Response.json(await agent.webModel());
    case "GET /web/models":
      return Response.json(await agent.webModels());
    case "POST /web/model": {
      const saved = await agent.webSetModel(String(body.text ?? ""));
      return Response.json(saved, { status: "error" in saved ? 400 : 200 });
    }
    case "GET /web/usage": {
      const before = Number(url.searchParams.get("before"));
      return Response.json(await agent.webUsage(Number.isSafeInteger(before) && before > 0 ? before : null));
    }
    case "GET /web/letter":
      return Response.json(await agent.webLetter());
    case "POST /web/letter/retry":
      return Response.json(await agent.webRetryLetters());
    case "GET /web/persona":
      return Response.json(await agent.webPersona());
    case "POST /web/persona": {
      const saved = await agent.webSetPersona(String(body.text ?? ""));
      return Response.json(saved, { status: "error" in saved ? 400 : 200 });
    }
    case "GET /web/config":
      return Response.json(await agent.webConfig());
    case "POST /web/config": {
      // A bot token saved here is connected to this address.
      await agent.noteOrigin(at.base);
      const saved = await agent.webSetConfig(String(body.key ?? ""), String(body.text ?? ""));
      return Response.json(saved, { status: "error" in saved ? 400 : 200 });
    }
    case "POST /web/telegram/connect": {
      await agent.noteOrigin(at.base);
      const connected = await agent.webTelegramConnect();
      return Response.json(connected, { status: "error" in connected ? 400 : 200 });
    }
    case "GET /web/mcp":
      return Response.json(await agent.webMcp());
    case "POST /web/mcp": {
      const saved = await agent.webAddMcp(String(body.name ?? ""), String(body.url ?? ""), String(body.key ?? ""), at.base);
      return Response.json(saved, { status: "error" in saved ? 400 : 200 });
    }
    case "POST /web/mcp/retry": {
      const tried = await agent.webRetryMcp(String(body.id ?? ""));
      return Response.json(tried, { status: "error" in tried ? 400 : 200 });
    }
    case "GET /web/sites":
      return Response.json(await agent.webSites());
    case "POST /web/sites": {
      const saved = await agent.webAddSite(String(body.site ?? ""), String(body.key ?? ""));
      return Response.json(saved, { status: "error" in saved ? 400 : 200 });
    }
    case "POST /web/sites/remove":
      return Response.json(await agent.webRemoveSite(String(body.host ?? "")));
    case "POST /web/mcp/remove":
      return Response.json(await agent.webRemoveMcp(String(body.id ?? "")));
    case "GET /web/stickers":
      return Response.json(await agent.webStickers());
    case "POST /web/stickers/import": {
      const saved = await agent.webImportStickerLink(String(body.url ?? ""));
      return Response.json(saved, { status: "error" in saved ? 400 : 200 });
    }
    case "POST /web/stickers/pack":
      return Response.json(await agent.webStickerPack(String(body.id ?? ""), body.on !== false));
    case "POST /web/stickers/remove":
      return Response.json(await agent.webRemoveStickerPack(String(body.id ?? "")));
    case "POST /web/stickers/edit": {
      const saved = await agent.webEditSticker(String(body.key ?? ""), String(body.when ?? ""), body.emoji === undefined ? undefined : String(body.emoji));
      return Response.json(saved, { status: "error" in saved ? 400 : 200 });
    }
    case "POST /web/stickers/delete":
      return Response.json(await agent.webRemoveSticker(String(body.key ?? "")));
    case "GET /web/alarms":
      return Response.json(await agent.webAlarms());
    case "POST /web/alarms/remove":
      return Response.json(await agent.webRemoveAlarm(String(body.id ?? "")));
    case "POST /web/alarms/edit": {
      const moved = await agent.webEditAlarm(String(body.id ?? ""), String(body.when ?? ""));
      return Response.json(moved, { status: "error" in moved ? 400 : 200 });
    }
    case "GET /web/tasks":
      return Response.json(await agent.webTasks(at.base));
    case "POST /web/tasks/test": {
      const place = body.execution === "linux" || body.execution === "local" ? body.execution : undefined;
      const tried = await agent.webTestTask(at.base, place);
      return Response.json(tried, { status: "error" in tried ? 400 : 200 });
    }
    case "POST /web/tasks/roles": {
      const saved = await agent.webSaveRole({ name: body.name, template: body.template, model: body.model });
      return Response.json(saved, { status: "error" in saved ? 400 : 200 });
    }
    case "POST /web/tasks/roles/remove":
      return Response.json(await agent.webRemoveRole(String(body.name ?? "")));
    case "POST /web/tasks/github": {
      const set = await agent.webGitHubSetup(at.base);
      return Response.json(set, { status: "error" in set ? 400 : 200 });
    }
    case "GET /web/runner":
      return Response.json(await agent.webMachine());
    case "POST /web/runner/code":
    case "POST /web/runner/register":
    case "POST /web/runner/revoke": {
      const done: { status: number; body: unknown } = url.pathname.endsWith("/code")
        ? await agent.webMachineCode()
        : url.pathname.endsWith("/register")
          ? await agent.machineRegister(body, true)
          : await agent.webMachineRevoke(typeof body.runnerId === "string" ? body.runnerId : undefined);
      return Response.json(done.body, { status: done.status, headers: { "cache-control": "no-store" } });
    }
    case "GET /web/threads":
      return Response.json(await agent.webThreads());
    case "GET /web/thread": {
      const id = url.searchParams.get("id") ?? "";
      if (!THREAD_ID.test(id)) return Response.json({ error: "没有这条线程" }, { status: 404 });
      const thread = await agent.webThread(id);
      return Response.json(thread, { status: "error" in thread ? 404 : 200 });
    }
    case "GET /web/thread/file": {
      // A thread's file goes out as bytes to save, never as a page of this origin: the web page decides how to show it.
      const id = url.searchParams.get("id") ?? "";
      const path = url.searchParams.get("path") ?? "";
      const bytes = THREAD_ID.test(id) && path ? await agent.webThreadFile(id, path) : null;
      if (!bytes) return new Response("not found", { status: 404 });
      return new Response(bytes, {
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": "attachment",
          "content-security-policy": "sandbox",
          "x-content-type-options": "nosniff",
          "cache-control": "no-store"
        }
      });
    }
    case "POST /web/thread/say": {
      const id = String(body.id ?? "");
      if (!THREAD_ID.test(id)) return Response.json({ error: "没有这条线程" }, { status: 404 });
      await agent.noteOrigin(at.base);
      const said = await agent.webThreadSay(id, String(body.text ?? ""));
      return Response.json(said, { status: "error" in said ? 400 : 200 });
    }
    default:
      return new Response("not found", { status: 404 });
  }
}

/** The paired machine's runner: JSON bodies of at most 16 KB, its own token as Bearer (pairing: a code instead). */
async function handleRunner(request: Request, env: Env, at: At, action: "pair" | "heartbeat" | "poll" | "receipt"): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  const parsed = await machineReply(() => readMachineJson(request));
  const answer = (result: { status: number; body: unknown }) => Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
  if (parsed.status !== 200) return answer(parsed);
  const agent = await residentOf(env, at);
  if (action === "pair") return answer(await agent.machineRegister(parsed.body, false));
  const bearer = (request.headers.get("authorization") ?? "").match(/^Bearer (\S+)$/)?.[1] ?? "";
  return answer(await agent.machineRequest(bearer, action, parsed.body));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      // Another resident's address: answered only for one on the list, as that resident's own address without /r/<id>.
      const { id, path } = residentOfPath(url.pathname);
      const at: At = { id, base: url.origin + residentPrefix(id) };
      if (id !== AGENT_NAME) {
        if (!(await (await getAgentByName(env.RESIDENT, AGENT_NAME)).residentKnown(id))) return new Response("not found", { status: 404 });
        // Its web page is the one page, opened on it; the hands' script is the one script.
        if (path === "/" && request.method === "GET") return Response.redirect(`${url.origin}/?r=${id}`, 302);
        if (path === "/hands.mjs" && request.method === "GET") return Response.redirect(`${url.origin}/hands.mjs`, 302);
        url.pathname = path;
      }
      if (url.pathname === TELEGRAM_WEBHOOK_PATH) return await handleWebhook(request, env, ctx, url, at);
      if (url.pathname === WECOM_PATH) return await handleWecom(request, env, url, at);
      if (url.pathname === "/tg/setup") return await handleSetup(request, env, url, at);
      if (url.pathname.startsWith("/web/")) return await handleWeb(request, env, url, at);
      if (url.pathname === "/manifest.webmanifest" && request.method === "GET" && id === AGENT_NAME) return await manifest(env);
      const avatar = url.pathname.match(/^\/avatar\/([0-9a-f]{32})$/);
      if (avatar && request.method === "GET") {
        const file = await (await residentOf(env, at)).avatarFile(avatar[1]);
        if (!file) return new Response("not found", { status: 404 });
        return new Response(file.bytes, {
          headers: { "content-type": file.type, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" }
        });
      }
      const sticker = url.pathname.match(/^\/stickers\/([0-9a-f]{24})$/);
      if (sticker && request.method === "GET") {
        const file = await (await residentOf(env, at)).stickerFile(sticker[1]);
        if (!file) return new Response("not found", { status: 404 });
        return new Response(file.bytes, {
          headers: { "content-type": file.type, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" }
        });
      }
      const runner = url.pathname.match(/^\/runner\/v1\/(pair|heartbeat|poll|receipt)$/);
      if (runner) return await handleRunner(request, env, at, runner[1] as "pair" | "heartbeat" | "poll" | "receipt");
      // A GitHub Actions run of the hands: the GitHub token to work with, and the model through the resident.
      const hands = url.pathname.match(/^\/tasks\/(t_[0-9a-f]{10})\/(hands|model\/chat\/completions)$/);
      if (hands && request.method === "POST") {
        const agent = await residentOf(env, at);
        if (hands[2] === "hands") {
          const answer = await agent.handsToken(hands[1], request.headers.get("x-task-code") ?? "");
          return Response.json(answer.body, { status: answer.status, headers: { "cache-control": "no-store" } });
        }
        if (Number(request.headers.get("content-length") ?? 0) > HANDS_MODEL_MAX_BYTES) return Response.json({ error: { message: "too large" } }, { status: 413 });
        const text = await request.text();
        if (text.length > HANDS_MODEL_MAX_BYTES) return Response.json({ error: { message: "too large" } }, { status: 413 });
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return Response.json({ error: { message: "the body must be JSON" } }, { status: 400 });
        }
        const code = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        const answer = await agent.handsModel(hands[1], code, body);
        return new Response(answer.json, { status: answer.status, headers: { "content-type": "application/json" } });
      }
      // A file the run made for them, kept with the thread's files on the web page.
      const handed = url.pathname.match(/^\/tasks\/(t_[0-9a-f]{10})\/files$/);
      if (handed && request.method === "POST") {
        if (Number(request.headers.get("content-length") ?? 0) > THREAD_FILE_MAX) return Response.json({ error: "too large" }, { status: 413 });
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.length > THREAD_FILE_MAX) return Response.json({ error: "too large" }, { status: 413 });
        const answer = await (await residentOf(env, at)).handsFile(handed[1], request.headers.get("x-task-code") ?? "", url.searchParams.get("path") ?? "", bytes);
        return Response.json(answer.body, { status: answer.status });
      }
      const report = url.pathname.match(/^\/tasks\/(t_[0-9a-f]{10})\/(progress|result)$/);
      if (report && request.method === "POST") {
        if (Number(request.headers.get("content-length") ?? 0) > REPORT_MAX_BYTES) return Response.json({ error: "too large" }, { status: 413 });
        const text = await request.text();
        if (text.length > REPORT_MAX_BYTES) return Response.json({ error: "too large" }, { status: 413 });
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return Response.json({ error: "the body must be JSON" }, { status: 400 });
        }
        const agent = await residentOf(env, at);
        const answer = await agent.taskReport(report[1], request.headers.get("x-task-code") ?? "", report[2] as "progress" | "result", body);
        return Response.json(answer.body, { status: answer.status });
      }
      // The resident checks the state against the sign-in it started; anything else is not for it. Only the
      // address goes in, never the caller's headers: a WebSocket upgrade here would otherwise open a connection
      // to the resident, which streams the conversation to every connection it has.
      if (url.pathname === MCP_CALLBACK_PATH && request.method === "GET" && url.searchParams.has("state")) {
        return await (await residentOf(env, at)).fetch(new Request(url.href));
      }
      return new Response("not found", { status: 404 });
    } catch (error) {
      // Non-2xx makes Telegram redeliver; the messenger dedupes by message id.
      console.error("aelios-resident request failed", { path: url.pathname, error: String(error) });
      return new Response("error", { status: 500, headers: url.pathname === "/tg/setup" ? { "cache-control": "no-store" } : undefined });
    }
  }
} satisfies ExportedHandler<Env>;
