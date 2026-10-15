// The Worker in front of the resident:
//   POST /messengers/telegram/webhook   Telegram → secret check, allowlist, slash commands → the resident
//   GET  /tg/setup?secret=…             points the bot's webhook here (open once after deploy); opened over https,
//                                       also makes the bot's menu button open the web page as a Mini App
//   /web/*                              the web page's API (same conversation as Telegram, the model, the persona
//                                       and the settings), behind WEB_KEY, or inside Telegram behind signed
//                                       initData / a Mini App session and TG_ALLOWED (mini-app.ts)
//   everything else                     the web page itself (public/)

import { getAgentByName } from "agents";
import { callerAllowed, issueSession, miniAppCaller, triesMiniApp } from "./mini-app";
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

async function handleSetup(env: Env, url: URL): Promise<Response> {
  const secret = env.TG_WEBHOOK_SECRET?.trim();
  if (!secret || !env.TG_BOT_TOKEN) return new Response("set TG_BOT_TOKEN and TG_WEBHOOK_SECRET first", { status: 400 });
  if (!timingSafeEqual(url.searchParams.get("secret") ?? "", secret)) return new Response("unauthorized", { status: 401 });
  // Telegram only opens Mini Apps from https; over http (local tests) the menu button is left alone.
  const https = url.protocol === "https:";
  const result = await setWebhook(telegram(env), `${url.origin}${WEBHOOK_PATH}`, secret, https ? { miniAppUrl: `${url.origin}/` } : {});
  if (!https) result.setChatMenuButton = { skipped: "the Mini App needs https; open /tg/setup on the https address" };
  return Response.json(result);
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
  const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as { text?: string; key?: string }) : {};
  switch (`${request.method} ${url.pathname}`) {
    case "GET /web/check":
      return Response.json({ ok: true, aelios: await agent.hasMemory(), via: who.via });
    case "GET /web/messages":
      return Response.json({ data: await agent.webHistory() });
    case "POST /web/say":
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
    default:
      return new Response("not found", { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === WEBHOOK_PATH) return await handleWebhook(request, env, ctx);
      if (url.pathname === "/tg/setup") return await handleSetup(env, url);
      if (url.pathname.startsWith("/web/")) return await handleWeb(request, env, url);
      return new Response("not found", { status: 404 });
    } catch (error) {
      // Non-2xx makes Telegram redeliver; the messenger dedupes by message id.
      console.error("aelios-resident request failed", { path: url.pathname, error: String(error) });
      return new Response("error", { status: 500 });
    }
  }
} satisfies ExportedHandler<Env>;
