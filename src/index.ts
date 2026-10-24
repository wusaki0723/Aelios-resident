// The Worker in front of the resident:
//   POST /messengers/telegram/webhook   Telegram → secret check, allowlist, slash commands → the resident
//   GET  /tg/setup?secret=…             points the bot's webhook here (open once after deploy; POST with the
//                                       x-tg-setup-secret header works too, for scripts); opened over https,
//                                       also makes the bot's menu button open the web page as a Mini App
//   /web/*                              the web page's API (same conversation as Telegram, the model, the persona
//                                       and the settings), behind WEB_KEY, or inside Telegram behind signed
//                                       initData / a Mini App session and TG_ALLOWED (mini-app.ts)
//   GET  /mcp/callback?code=…&state=…   where an MCP server's OAuth sign-in comes back to (mcp-servers.ts)
//   GET  /stickers/<key>                a sticker's picture for the web page (stickers.ts); the key is long and random
//   POST /tasks/<id>/progress|result    a cloud Claude Code session reporting on its task (cloud-tasks.ts), with the
//                                       task's one-time code in x-task-code
//   everything else                     the web page itself (public/)

import { getAgentByName } from "agents";
import { callerAllowed, issueSession, miniAppCaller, triesMiniApp } from "./mini-app";
import { MCP_CALLBACK_PATH } from "./mcp-servers";
import { MAX_ZIP_BYTES } from "./stickers";
import { REPORT_MAX_BYTES } from "./cloud-tasks";
import { commandOf, isAllowed, sendBubbles, setWebhook, timingSafeEqual, type TelegramUpdate } from "./telegram";

export { ThinkMessengerStateAgent } from "@cloudflare/think/messengers";
export { Resident } from "./resident";

const WEBHOOK_PATH = "/messengers/telegram/webhook";
// Telegram and the web page both talk to this one agent.
const AGENT_NAME = "default";

function telegram(env: Env) {
  return { token: env.TG_BOT_TOKEN ?? "", apiBase: env.TG_API_BASE };
}

async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  const secret = env.TG_WEBHOOK_SECRET?.trim();
  const got = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || !env.TG_BOT_TOKEN || !timingSafeEqual(got, secret)) return new Response("unauthorized", { status: 401 });

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
  const agent = await getAgentByName(env.RESIDENT, AGENT_NAME);
  // TG_ALLOWED can be set on the settings page, so the resident says what is in effect.
  if (!isAllowed(await agent.telegramAllowed(), String(chatId), message.from?.username)) {
    // No reply, so strangers cannot probe the bot. The log line shows what to put in TG_ALLOWED.
    console.log("tg: dropped message from a chat not in TG_ALLOWED", { chatId, username: message.from?.username });
    return new Response("ok");
  }

  const command = commandOf(message.text);
  if (command) {
    // The Think messenger ignores slash commands; the Worker answers them without a model turn.
    ctx.waitUntil(
      agent
        .command(command)
        .then((text) => sendBubbles(telegram(env), String(chatId), text, { bubbles: false }))
        .catch((error) => console.error("tg: command failed", { command, error: String(error) }))
    );
    return new Response("ok");
  }
  return agent.fetch(new Request(request.url, { method: "POST", headers: request.headers, body }));
}

async function handleSetup(request: Request, env: Env, url: URL): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { ...headers, allow: "GET, POST" } });
  }
  const secret = env.TG_WEBHOOK_SECRET?.trim();
  if (!secret || !env.TG_BOT_TOKEN) return new Response("set TG_BOT_TOKEN and TG_WEBHOOK_SECRET first", { status: 400, headers });
  // Opened in a browser the secret is in the address; a script can send it as a header instead.
  const given = request.headers.get("x-tg-setup-secret") ?? url.searchParams.get("secret") ?? "";
  if (!timingSafeEqual(given, secret)) return new Response("unauthorized", { status: 401, headers });
  // The address an MCP sign-in started from the chat comes back to.
  await (await getAgentByName(env.RESIDENT, AGENT_NAME)).noteOrigin(url.origin);
  // Telegram only opens Mini Apps from https; over http (local tests) the menu button is left alone.
  const https = url.protocol === "https:";
  const result = await setWebhook(telegram(env), `${url.origin}${WEBHOOK_PATH}`, secret, https ? { miniAppUrl: `${url.origin}/` } : {});
  if (!https) result.setChatMenuButton = { skipped: "the Mini App needs https; open /tg/setup on the https address" };
  return Response.json(result, { headers });
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
async function webCaller(env: Env, request: Request): Promise<WebCaller | null> {
  if (webAllowed(env, request)) return { via: "web" };
  if (!triesMiniApp(request)) return null;
  // The signature is checked before the resident is woken up.
  const caller = await miniAppCaller(request, env.TG_BOT_TOKEN);
  if (!caller) return null;
  const agent = await getAgentByName(env.RESIDENT, AGENT_NAME);
  if (!callerAllowed(await agent.telegramAllowed(), caller)) {
    console.log("web: Mini App user not in TG_ALLOWED", { id: caller.user.id, username: caller.user.username });
    return null;
  }
  return { via: "telegram", caller };
}

async function handleWeb(request: Request, env: Env, url: URL): Promise<Response> {
  const who = await webCaller(env, request);
  if (!who) return new Response("unauthorized", { status: 401 });
  if (url.pathname === "/web/session") {
    // Only the Mini App gets sessions; WEB_KEY is used as it is.
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    if (who.via !== "telegram") return new Response("the Mini App way in only", { status: 400 });
    const { user, auth } = who.caller;
    const session = await issueSession(env.TG_BOT_TOKEN ?? "", user, auth);
    return Response.json(
      { ...session, user: { id: user.id, username: user.username ?? null, first_name: user.first_name ?? null } },
      { headers: { "cache-control": "no-store" } }
    );
  }
  const agent = await getAgentByName(env.RESIDENT, AGENT_NAME);
  // A sticker pack's zip comes as it is, its file name in ?name=.
  if (url.pathname === "/web/stickers/import" && request.method === "POST" && !/json/.test(request.headers.get("content-type") ?? "")) {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_ZIP_BYTES) return Response.json({ error: `压缩包最多 ${MAX_ZIP_BYTES / 1024 / 1024} MB` }, { status: 413 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    const saved = await agent.webImportStickerZip(bytes, (url.searchParams.get("name") ?? "").replace(/\.zip$/i, ""));
    return Response.json(saved, { status: "error" in saved ? 400 : 200 });
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
        })
      : {};
  switch (`${request.method} ${url.pathname}`) {
    case "GET /web/check":
      return Response.json({ ok: true, aelios: await agent.hasMemory(), via: who.via });
    case "GET /web/messages":
      return Response.json({ data: await agent.webHistory() });
    case "POST /web/say":
      await agent.noteOrigin(url.origin);
      return Response.json(await agent.webSay(String(body.text ?? "")));
    case "POST /web/pin":
      return Response.json({ ok: await agent.webPin(String(body.text ?? "")) });
    case "GET /web/model":
      return Response.json(await agent.webModel());
    case "POST /web/model": {
      const saved = await agent.webSetModel(String(body.text ?? ""));
      return Response.json(saved, { status: "error" in saved ? 400 : 200 });
    }
    case "GET /web/persona":
      return Response.json(await agent.webPersona());
    case "POST /web/persona": {
      const saved = await agent.webSetPersona(String(body.text ?? ""));
      return Response.json(saved, { status: "error" in saved ? 400 : 200 });
    }
    case "GET /web/config":
      return Response.json(await agent.webConfig());
    case "POST /web/config": {
      const saved = await agent.webSetConfig(String(body.key ?? ""), String(body.text ?? ""));
      return Response.json(saved, { status: "error" in saved ? 400 : 200 });
    }
    case "GET /web/mcp":
      return Response.json(await agent.webMcp());
    case "POST /web/mcp": {
      const saved = await agent.webAddMcp(String(body.name ?? ""), String(body.url ?? ""), String(body.key ?? ""), url.origin);
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
    case "GET /web/tasks":
      return Response.json(await agent.webTasks(url.origin));
    case "POST /web/tasks/test": {
      const tried = await agent.webTestTask(url.origin);
      return Response.json(tried, { status: "error" in tried ? 400 : 200 });
    }
    default:
      return new Response("not found", { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === WEBHOOK_PATH) return await handleWebhook(request, env, ctx);
      if (url.pathname === "/tg/setup") return await handleSetup(request, env, url);
      if (url.pathname.startsWith("/web/")) return await handleWeb(request, env, url);
      const sticker = url.pathname.match(/^\/stickers\/([0-9a-f]{24})$/);
      if (sticker && request.method === "GET") {
        const file = await (await getAgentByName(env.RESIDENT, AGENT_NAME)).stickerFile(sticker[1]);
        if (!file) return new Response("not found", { status: 404 });
        return new Response(file.bytes, {
          headers: { "content-type": file.type, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" }
        });
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
        const agent = await getAgentByName(env.RESIDENT, AGENT_NAME);
        const answer = await agent.taskReport(report[1], request.headers.get("x-task-code") ?? "", report[2] as "progress" | "result", body);
        return Response.json(answer.body, { status: answer.status });
      }
      // The resident checks the state against the sign-in it started; anything else is not for it. Only the
      // address goes in, never the caller's headers: a WebSocket upgrade here would otherwise open a connection
      // to the resident, which streams the conversation to every connection it has.
      if (url.pathname === MCP_CALLBACK_PATH && request.method === "GET" && url.searchParams.has("state")) {
        return await (await getAgentByName(env.RESIDENT, AGENT_NAME)).fetch(new Request(url.href));
      }
      return new Response("not found", { status: 404 });
    } catch (error) {
      // Non-2xx makes Telegram redeliver; the messenger dedupes by message id.
      console.error("aelios-resident request failed", { path: url.pathname, error: String(error) });
      return new Response("error", { status: 500, headers: url.pathname === "/tg/setup" ? { "cache-control": "no-store" } : undefined });
    }
  }
} satisfies ExportedHandler<Env>;
