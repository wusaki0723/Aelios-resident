// Stands in for the Telegram Bot API, Aelios, other MCP servers and the WeCom relay during local tests. Records every
// call.
import http from "node:http";
import { GIF, PNG } from "./zip.mjs";

const log = [];
// GitHub repositories the hands set up, by owner/name.
const ghRepos = new Map();
let nextMessageId = 1000;
let faults = { ingestFailures: 0, letterModel: "ok" };
const ORIGIN = "http://127.0.0.1:9999";
// The WeCom relay's key, and the app the fake WeCom knows.
const WECOM_RELAY_KEY = "relay-key-for-tests-0123456789abcdef";
const WECOM_CORP_ID = "wwtest0001";
const WECOM_SECRET = "wecom-secret";
let wecomTokens = 0;
// Where each bot's webhook points (setWebhook / deleteWebhook), by token; a token starting "bad" is one Telegram refuses.
const webhooks = new Map();

// Other MCP servers: /ext and /ext2 are open, /keyed wants x-api-key: k1, /oauth wants a token from its sign-in.
// echo's descriptions are long on purpose, and one of its parameters is called title, which must survive trimming.
const TOOLS = [
  {
    name: "echo",
    description: `Echo the text back. ${"It says it again. ".repeat(30)}\n\nUsage notes nobody needs every turn.`,
    inputSchema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      title: "EchoArgs",
      properties: {
        text: { type: "string", description: `What to echo. ${"More words. ".repeat(30)}` },
        title: { type: "string", description: "A parameter that happens to be called title." }
      },
      required: ["text"]
    }
  },
  { name: "add", description: "Add two numbers.", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } }
];

function mcpServer(name, req, res, json) {
  const send = (status, obj, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(obj === undefined ? "" : JSON.stringify(obj));
  };
  if (req.method !== "POST") return send(405, { error: "method not allowed" });
  const messages = Array.isArray(json) ? json : [json];
  const answers = [];
  for (const message of messages) {
    if (!message || message.id === undefined) continue;
    const result = (() => {
      switch (message.method) {
        case "initialize":
          return { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name, version: "1.0.0" } };
        case "ping":
          return {};
        case "tools/list":
          return { tools: TOOLS };
        case "tools/call": {
          const args = message.params?.arguments ?? {};
          if (message.params?.name === "echo") return { content: [{ type: "text", text: `${name} echo: ${args.text}` }] };
          if (message.params?.name === "add") return { content: [{ type: "text", text: String(Number(args.a) + Number(args.b)) }] };
          return { content: [{ type: "text", text: "no such tool" }], isError: true };
        }
        default:
          return null;
      }
    })();
    answers.push(result ? { jsonrpc: "2.0", id: message.id, result } : { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  }
  if (!answers.length) return send(202);
  return send(200, Array.isArray(json) ? answers : answers[0]);
}

const authServer = {
  issuer: `${ORIGIN}/oauth`,
  authorization_endpoint: `${ORIGIN}/oauth/authorize`,
  token_endpoint: `${ORIGIN}/oauth/token`,
  registration_endpoint: `${ORIGIN}/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"]
};

// A Telegram sticker pack: a still sticker, a video one and an animated (TGS) one, which only has a thumbnail to show.
const STICKER_SET = {
  name: "TestPack",
  title: "Test Pack",
  sticker_type: "regular",
  stickers: [
    { file_id: "tg-still", emoji: "😀", is_animated: false, is_video: false },
    { file_id: "tg-video", emoji: "🥰", is_animated: false, is_video: true },
    { file_id: "tg-anim", emoji: "😴", is_animated: true, is_video: false, thumbnail: { file_id: "tg-anim-thumb" } }
  ]
};
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([20, 0, 0, 0]), Buffer.from("WEBPVP8L"), Buffer.alloc(12)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16)]);
// A voice message she sends (Ogg), and one second of 128 kbit/s MP3 behind an ID3 tag, as the voice providers send.
const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(28)]);
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.from([4, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(16000 - 4)]);

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  const body = raw.toString();
  let json;
  try {
    json = body ? JSON.parse(body) : undefined;
  } catch {
    // The OAuth token request is a form; a file upload to Telegram is multipart.
    json = undefined;
  }
  // A multipart upload (sendSticker and the like): its fields, and for each file its name, type and first bytes.
  if (!json && /multipart\/form-data/.test(req.headers["content-type"] ?? "")) {
    const parse = (bytes) => new Response(bytes, { headers: { "content-type": req.headers["content-type"] } }).formData();
    // WeCom's upload names the file's length in its part (filelength=…), which Node's parser does not take.
    const form = await parse(raw).catch(() => parse(Buffer.from(raw.toString("latin1").replace(/; ?filelength=\d+/g, ""), "latin1")));
    json = { multipart: true };
    for (const [key, value] of form) {
      json[key] = typeof value === "string" ? value : { file: value.name, type: value.type, size: value.size, head: Buffer.from(await value.arrayBuffer()).subarray(0, 6).toString("latin1") };
    }
  }
  const url = new URL(req.url, "http://x");
  const reply = (obj, status = 200, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === "/__log") return reply(log);
  if (url.pathname === "/__reset") {
    log.length = 0;
    faults = { ingestFailures: 0, letterModel: "ok" };
    wecomTokens = 0;
    webhooks.clear();
    ghRepos.clear();
    return reply({ ok: true });
  }
  if (url.pathname === "/__faults" && req.method === "POST") {
    faults = { ...faults, ...json };
    return reply({ ok: true });
  }

  // A file the bot downloads after getFile: a few bytes that start like a JPEG, or a sticker's WebP or WebM.
  const file = url.pathname.match(/^\/file\/bot[^/]+\/(.+)$/);
  if (file) {
    log.push({ kind: "tg.file", path: file[1] });
    if (file[1].endsWith(".webp")) {
      res.writeHead(200, { "content-type": "image/webp" });
      return res.end(WEBP);
    }
    if (file[1].endsWith(".oga")) {
      res.writeHead(200, { "content-type": "audio/ogg" });
      return res.end(OGG);
    }
    if (file[1].endsWith(".webm")) {
      res.writeHead(200, { "content-type": "video/webm" });
      return res.end(WEBM);
    }
    res.writeHead(200, { "content-type": "image/jpeg" });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
    // A synthetic payload above Think's 32 KiB media-eviction threshold (no real model decodes it).
    return res.end(file[1].includes("cache-large-photo") ? Buffer.concat([jpeg, Buffer.alloc(40 * 1024)]) : jpeg);
  }

  const tg = url.pathname.match(/^\/bot([^/]+)\/(\w+)$/);
  if (tg) {
    const token = decodeURIComponent(tg[1]);
    const method = tg[2];
    log.push({ kind: `tg.${method}`, body: json, token });
    if (token.includes(":bad")) return reply({ ok: false, error_code: 401, description: "Unauthorized" }, 401);
    // faults.slowDeleteWebhook: milliseconds a bot takes to let go, to hold a resident's deletion open.
    if (method === "deleteWebhook" && faults.slowDeleteWebhook) await new Promise((resolve) => setTimeout(resolve, faults.slowDeleteWebhook));
    // faults.slowSetWebhook: milliseconds Telegram takes to take a webhook, longer than the resident waits to start again.
    if (method === "setWebhook" && faults.slowSetWebhook) await new Promise((resolve) => setTimeout(resolve, faults.slowSetWebhook));
    // faults.menuButton false: Telegram turns the menu button down once, as when it was never set.
    if (method === "setChatMenuButton" && faults.menuButton === false) {
      faults.menuButton = true;
      return reply({ ok: false, error_code: 500, description: "Internal Server Error" }, 500);
    }
    const chat = { id: Number(json?.chat_id ?? 42), type: "private" };
    const message = () => ({ message_id: nextMessageId++, date: Math.floor(Date.now() / 1000), chat, text: json?.text });
    switch (method) {
      case "getMe":
        return reply({ ok: true, result: { id: 777, is_bot: true, first_name: "Resident", username: "resident_test_bot" } });
      case "sendMessage":
      case "editMessageText":
        return reply({ ok: true, result: message() });
      case "getFile": {
        // "gone" stands for a file Telegram no longer has.
        if (json?.file_id === "gone") return reply({ ok: false, error_code: 400, description: "Bad Request: invalid file_id" }, 400);
        const id = String(json?.file_id ?? "");
        const path = id === "tg-video" ? `stickers/${id}.webm` : id.startsWith("tg-") ? `stickers/${id}.webp` : id.startsWith("voice-") ? `voice/${id}.oga` : `photos/${id}.jpg`;
        return reply({ ok: true, result: { file_id: id, file_path: path } });
      }
      case "getStickerSet":
        if (json?.name !== STICKER_SET.name) return reply({ ok: false, error_code: 400, description: "Bad Request: STICKERSET_INVALID" }, 400);
        return reply({ ok: true, result: STICKER_SET });
      case "sendSticker":
      case "sendAnimation":
      case "sendPhoto": {
        const field = { sendSticker: "sticker", sendAnimation: "animation", sendPhoto: "photo" }[method];
        // "stale-…" stands for a file id Telegram no longer takes.
        if (typeof json?.[field] === "string" && json[field].startsWith("stale-")) {
          return reply({ ok: false, error_code: 400, description: "Bad Request: wrong file identifier" }, 400);
        }
        // An uploaded WebP that is no proper sticker (not 512 pixels): Telegram will not take it as one.
        if (method === "sendSticker" && json?.multipart && json.sticker?.type === "image/webp") {
          return reply({ ok: false, error_code: 400, description: "Bad Request: STICKER_PNG_DIMENSIONS" }, 400);
        }
        const id = typeof json?.[field] === "string" ? json[field] : `up-${method}-${nextMessageId}`;
        const media = method === "sendSticker" ? { sticker: { file_id: id } } : method === "sendAnimation" ? { animation: { file_id: id }, document: { file_id: id } } : { photo: [{ file_id: `${id}-s` }, { file_id: id }] };
        return reply({ ok: true, result: { message_id: nextMessageId++, date: Math.floor(Date.now() / 1000), chat, ...media } });
      }
      case "sendDocument":
        return reply({ ok: true, result: { message_id: nextMessageId++, date: Math.floor(Date.now() / 1000), chat, document: { file_id: `up-doc-${nextMessageId}`, file_name: json?.document?.file ?? "" } } });
      case "sendVoice":
        return reply({ ok: true, result: { message_id: nextMessageId++, date: Math.floor(Date.now() / 1000), chat, voice: { file_id: `up-voice-${nextMessageId}`, duration: Number(json?.duration ?? 0) } } });
      case "setWebhook":
        webhooks.set(token, String(json?.url ?? ""));
        return reply({ ok: true, result: true });
      case "deleteWebhook":
        webhooks.delete(token);
        return reply({ ok: true, result: true });
      case "getWebhookInfo":
        return reply({ ok: true, result: { url: webhooks.get(token) ?? "", pending_update_count: 0 } });
      case "sendChatAction":
      case "setMyCommands":
      case "setChatMenuButton":
        return reply({ ok: true, result: true });
      default:
        // e.g. sendRichMessage: an older Bot API, so the adapter falls back to sendMessage.
        return reply({ ok: false, error_code: 404, description: "Not Found: method not found" }, 404);
    }
  }
  // The WeCom relay (relay/wecom/) with WeCom behind it, at /wecom-relay. It wants the relay key, and WeCom the CorpID
  // and Secret above. faults.wecomMedia false stands for a relay installed without --media; faults.wecomExpire makes
  // the next message/send say the access token expired. MediaIds she "sent": voice-… is AMR, pic-… a PNG.
  const relay = url.pathname.match(/^\/wecom-relay(\/.*)$/);
  if (relay) {
    const path = relay[1];
    const token = url.searchParams.get("access_token");
    if (req.headers["x-relay-key"] !== WECOM_RELAY_KEY) {
      log.push({ kind: "wecom.refused", path });
      return reply({ error: "forbidden" }, 403);
    }
    const media = faults.wecomMedia !== false;
    if (path === "/ping") return reply({ ok: true, media: { amr: media, mp3: media, gif: media, png: media } });
    const convert = path.match(/^\/media\/(amr|mp3|gif|png)$/);
    if (convert) {
      if (!media) return reply({ error: "this relay does not convert" }, 501);
      log.push({ kind: "wecom.convert", to: convert[1], head: raw.subarray(0, 6).toString("latin1"), size: raw.length });
      const out = { amr: Buffer.concat([Buffer.from("#!AMR\n"), Buffer.alloc(64)]), mp3: MP3, gif: GIF, png: PNG }[convert[1]];
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(out);
    }
    if (path === "/cgi-bin/gettoken") {
      log.push({ kind: "wecom.gettoken" });
      if (url.searchParams.get("corpid") !== WECOM_CORP_ID || url.searchParams.get("corpsecret") !== WECOM_SECRET) return reply({ errcode: 40001, errmsg: "invalid credential" });
      wecomTokens += 1;
      return reply({ errcode: 0, errmsg: "ok", access_token: `wecom-token-${wecomTokens}`, expires_in: 7200 });
    }
    if (token !== `wecom-token-${wecomTokens}`) return reply({ errcode: 40014, errmsg: "invalid access_token" });
    if (path === "/cgi-bin/message/send") {
      if (faults.wecomExpire) {
        faults.wecomExpire = false;
        return reply({ errcode: 42001, errmsg: "access_token expired" });
      }
      log.push({ kind: "wecom.send", body: json });
      return reply({ errcode: 0, errmsg: "ok", msgid: `wecom-msg-${nextMessageId++}` });
    }
    if (path === "/cgi-bin/media/upload") {
      log.push({ kind: "wecom.upload", type: url.searchParams.get("type"), media: json?.media ?? null, filelength: /filelength=\d+/.test(body) });
      return reply({ errcode: 0, errmsg: "ok", type: url.searchParams.get("type"), media_id: `wecom-media-${nextMessageId++}` });
    }
    if (path === "/cgi-bin/media/get") {
      const id = url.searchParams.get("media_id") ?? "";
      log.push({ kind: "wecom.get", id });
      if (id.startsWith("voice-")) {
        res.writeHead(200, { "content-type": "audio/amr" });
        return res.end(Buffer.concat([Buffer.from("#!AMR\n"), Buffer.alloc(64)]));
      }
      if (id.startsWith("pic-")) {
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(PNG);
      }
      return reply({ errcode: 40007, errmsg: "invalid media_id" });
    }
    if (path === "/cgi-bin/message/recall") return reply({ errcode: 0, errmsg: "ok" });
    return reply({ errcode: 404, errmsg: "not found" }, 404);
  }

  // Voice providers, reached through VOICE_BASE_URL=http://127.0.0.1:9999/voice: ElevenLabs Scribe and text to
  // speech, Cartesia, and OpenRouter's speech endpoint. A text with 炸 in it fails, so the reply goes out as text.
  const voice = url.pathname.match(/^\/voice\/(v1\/speech-to-text|v1\/text-to-speech\/[^/]+|tts\/bytes|v1\/audio\/speech)$/);
  if (voice) {
    const headers = Object.fromEntries(["authorization", "xi-api-key", "cartesia-version", "accept"].filter((h) => req.headers[h]).map((h) => [h, req.headers[h]]));
    log.push({ kind: "voice", endpoint: voice[1], query: url.search, headers, body: json });
    if (voice[1] === "v1/speech-to-text") {
      if (json?.file?.head?.startsWith("OggS")) return reply({ text: " 今天好累呀 " });
      // A voice message recorded on the web page: a WAV.
      if (json?.file?.head?.startsWith("RIFF")) return reply({ text: " 网页上说的话 " });
      // A WeCom voice message, made MP3 by the relay on the way down.
      if (json?.file?.head?.startsWith("ID3") && json.file.type === "audio/mpeg") return reply({ text: " 企微里说的话 " });
      return reply({ detail: "unreadable audio" }, 422);
    }
    const said = json?.text ?? json?.transcript ?? json?.input ?? "";
    if (said.includes("炸")) return reply({ error: { message: "the voice service fell over" } }, 500);
    res.writeHead(200, { "content-type": "audio/mpeg" });
    return res.end(MP3);
  }

  // A scheduled task's API trigger (CLOUD_TASK_API_BASE=http://127.0.0.1:9999): wants the token "good-token" and
  // both headers, and answers with a session link. trig_busyone has fired too often this hour.
  const routine = url.pathname.match(/^\/v1\/claude_code\/routines\/(trig_\w+)\/fire$/);
  if (routine) {
    const headers = Object.fromEntries(["authorization", "anthropic-beta", "anthropic-version"].map((h) => [h, req.headers[h] ?? null]));
    log.push({ kind: "routine.fire", trigger: routine[1], headers, body: json });
    if (req.headers.authorization !== "Bearer good-token") return reply({ type: "error", error: { type: "authentication_error", message: "invalid token" } }, 401);
    if (!req.headers["anthropic-beta"] || !req.headers["anthropic-version"]) return reply({ type: "error", error: { message: "missing header" } }, 400);
    if (routine[1] === "trig_busyone") return reply({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }, 429);
    const n = log.filter((e) => e.kind === "routine.fire").length;
    return reply({ type: "routine_fire", claude_code_session_id: `session_test_${n}`, claude_code_session_url: `https://claude.ai/code/session_test_${n}` });
  }

  // GitHub for the hands (src/hands-repo.ts): the token "good-token" is octo's; "no-workflow-token" cannot write
  // workflow files. The repository it makes is kept here, and a run starts only once its workflow is in.
  const ghAuth = req.headers.authorization;
  if (url.pathname === "/user" && req.method === "GET") {
    log.push({ kind: "github.user", auth: ghAuth ?? null });
    if (ghAuth !== "Bearer good-token" && ghAuth !== "Bearer no-workflow-token") return reply({ message: "Bad credentials" }, 401);
    return reply({ login: "octo" });
  }
  if (url.pathname === "/user/repos" && req.method === "POST") {
    log.push({ kind: "github.create", body: json });
    ghRepos.set(`octo/${json.name}`, { private: Boolean(json.private), files: new Map() });
    return reply({ private: Boolean(json.private), default_branch: "main", html_url: `https://github.com/octo/${json.name}` }, 201);
  }
  const ghRepo = url.pathname.match(/^\/repos\/([\w.-]+\/[\w.-]+)$/);
  if (ghRepo && req.method === "GET") {
    const found = ghRepos.get(ghRepo[1]);
    return found ? reply({ private: found.private, default_branch: "main", html_url: `https://github.com/${ghRepo[1]}` }) : reply({ message: "Not Found" }, 404);
  }
  const ghFile = url.pathname.match(/^\/repos\/([\w.-]+\/[\w.-]+)\/contents\/(.+)$/);
  if (ghFile) {
    const found = ghRepos.get(ghFile[1]);
    if (!found) return reply({ message: "Not Found" }, 404);
    const kept = found.files.get(ghFile[2]);
    if (req.method === "GET") return kept ? reply({ sha: kept.sha, content: Buffer.from(kept.text).toString("base64") }) : reply({ message: "Not Found" }, 404);
    log.push({ kind: "github.file", path: ghFile[2], branch: json?.branch ?? null });
    if (ghAuth === "Bearer no-workflow-token") return reply({ message: "refusing to allow a Personal Access Token to create or update workflow without `workflow` scope" }, 404);
    found.files.set(ghFile[2], { text: Buffer.from(json.content, "base64").toString("utf8"), sha: `sha_${log.length}` });
    return reply({}, kept ? 200 : 201);
  }

  const ghDispatch = url.pathname.match(/^\/repos\/([\w.-]+\/[\w.-]+)\/actions\/workflows\/([\w.-]+\.ya?ml|\d+)\/dispatches$/);
  if (ghDispatch) {
    const headers = Object.fromEntries(["authorization", "accept", "x-github-api-version"].map((h) => [h, req.headers[h] ?? null]));
    log.push({ kind: "github.dispatch", repo: ghDispatch[1], workflow: ghDispatch[2], headers, body: json });
    if (req.headers.authorization !== "Bearer good-token") return reply({ message: "Bad credentials" }, 401);
    if (!ghRepos.get(ghDispatch[1])?.files.has(`.github/workflows/${ghDispatch[2]}`)) return reply({ message: "Not Found" }, 404);
    // Asked for run details, GitHub names the run it started (200); without, it answers 204.
    if (!json?.return_run_details) {
      res.writeHead(204);
      return res.end();
    }
    const run = log.filter((e) => e.kind === "github.dispatch").length;
    return reply({ workflow_run_id: run, run_url: `${ORIGIN}/repos/${ghDispatch[1]}/actions/runs/${run}`, html_url: `https://github.com/${ghDispatch[1]}/actions/runs/${run}` });
  }

  const mcp = url.pathname.match(/^\/(ext|ext2|keyed|oauth)\/mcp$/);
  if (mcp) {
    const who = mcp[1];
    log.push({ kind: `ext.${who}`, httpMethod: req.method, method: json?.method ?? null, auth: req.headers.authorization ?? null,
      apiKey: req.headers["x-api-key"] ?? null, tool: json?.params?.name ?? null, args: json?.params?.arguments ?? null });
    if (who === "keyed" && req.headers["x-api-key"] !== "k1") return reply({ error: "a key is needed" }, 403);
    if (who === "oauth" && req.headers.authorization !== "Bearer tok-1") {
      res.writeHead(401, { "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/oauth/mcp"` });
      return res.end(JSON.stringify({ error: "invalid_token" }));
    }
    return mcpServer(who, req, res, json);
  }
  if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
    log.push({ kind: "oauth.resource", path: url.pathname });
    return reply({ resource: `${ORIGIN}/oauth/mcp`, authorization_servers: [`${ORIGIN}/oauth`] });
  }
  if (url.pathname.includes("/.well-known/oauth-authorization-server") || url.pathname.includes("/.well-known/openid-configuration")) {
    log.push({ kind: "oauth.metadata", path: url.pathname });
    return reply(authServer);
  }
  if (url.pathname === "/oauth/register") {
    log.push({ kind: "oauth.register", body: json });
    return reply({ ...json, client_id: "cid-1", token_endpoint_auth_method: "none" }, 201);
  }
  if (url.pathname === "/oauth/authorize") {
    // Stands in for her signing in: straight back to the resident with a code.
    log.push({ kind: "oauth.authorize", query: Object.fromEntries(url.searchParams) });
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", "code-1");
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    res.writeHead(302, { location: back.href });
    return res.end();
  }
  if (url.pathname === "/oauth/token") {
    const form = Object.fromEntries(new URLSearchParams(body));
    log.push({ kind: "oauth.token", form });
    if (form.grant_type === "authorization_code" && form.code !== "code-1") return reply({ error: "invalid_grant" }, 400);
    return reply({ access_token: "tok-1", token_type: "Bearer", expires_in: 3600, refresh_token: "ref-1" });
  }
  const auth = req.headers.authorization;
  if (url.pathname === "/v1/memory/recall") {
    log.push({ kind: "aelios.recall", body: json, auth });
    // Only a question about her birthday finds something, so ordinary test messages recall nothing.
    const hit = { id: "mem-birthday", content: "她的生日在春天", type: "fact", score: 0.9 };
    return reply({ data: String(json.query ?? "").includes("生日") ? [hit] : [] });
  }
  // Aelios' own stateless MCP server, answering tools/call with plain JSON.
  if (url.pathname === "/mcp") {
    log.push({ kind: "aelios.mcp", body: json, auth });
    // The notebook gives back a long page, longer than other tools' answers are kept.
    const notebook = json.params?.name === "notebook" && json.params.arguments?.action === "read";
    const page = { name: "经济师进度", content: `${"第 28 章学完，质量要求题要抓题干动作。".repeat(300)}下一步：第 29 章`, updated_at: "2026-10-23T00:00:00Z" };
    const text = JSON.stringify(notebook ? { data: page } : { data: { id: "mem-new", created: true } });
    return reply({ jsonrpc: "2.0", id: json.id, result: { content: [{ type: "text", text }] } });
  }
  if (url.pathname === "/v1/memory/ingest") {
    log.push({ kind: "aelios.ingest", body: json, auth, letterId: req.headers["x-resident-letter-id"] ?? null });
    if (json.source === "aelios-resident:letter" && faults.ingestFailures > 0) {
      faults.ingestFailures -= 1;
      return reply({ error: "temporary failure with PRIVATE_UPSTREAM_DETAIL" }, 503);
    }
    return reply({ data: { conversation_id: json.conversation_id, message_ids: [crypto.randomUUID()] } });
  }
  if (url.pathname === "/v1/precious") {
    log.push({ kind: "aelios.precious", body: json, auth });
    return reply({ data: { id: "p1", content: json.content } }, 201);
  }
  if (url.pathname === "/v1/memory_boot") {
    log.push({ kind: "aelios.boot", query: url.search, auth });
    // Says how many times it has been fetched, so a test can tell which packet a turn carries.
    const fetched = log.filter((e) => e.kind === "aelios.boot").length;
    return reply({
      data: {
        daily_log: { date: "2026-10-21", title: "闲聊日", summary: `昨天你们聊了周末去哪儿玩。（第 ${fetched} 次取）` },
        precious: [{ content: "说好了要一起去看海。" }],
        glossary: [{ term: "小橘", definition: "楼下那只猫" }]
      }
    });
  }
  // Models: a provider of your own (custom/…), and Aelios' model endpoint (/v1/… or /<identity>/v1/…).
  // Both answer OpenAI chat completions and Anthropic messages with a line saying what they got.
  const textOf = (content) => (typeof content === "string" ? content : (content ?? []).find((p) => p.type === "text")?.text ?? "");
  const sse = (events, headers = {}) => {
    res.writeHead(200, { "content-type": "text/event-stream", ...headers });
    for (const [event, data] of events) res.write(`${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
    res.end();
  };
  const chat = (text, headers = {}) => {
    const usage = { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 };
    if (!json.stream) {
      res.writeHead(200, { "content-type": "application/json", ...headers });
      return res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 0, model: json.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage }));
    }
    const chunk = (delta, finish, extra = {}) => ({ id: "c1", object: "chat.completion.chunk", created: 0, model: json.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra });
    return sse([[null, chunk({ role: "assistant", content: text }, null)], [null, chunk({}, "stop", { usage })], [null, "[DONE]"]], headers);
  };
  const messages = (text, headers = {}) => {
    // With a cache marker, part of the prompt is read from the cache and part written, split by the marker's TTL.
    const ttl = JSON.stringify(json).match(/"cache_control":\{"type":"ephemeral"(?:,"ttl":"(5m|1h)")?\}/)?.[1] ?? (cached() === "有" ? "5m" : null);
    const usage = ttl
      ? { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 300,
          cache_creation: { ephemeral_5m_input_tokens: ttl === "5m" ? 300 : 0, ephemeral_1h_input_tokens: ttl === "1h" ? 300 : 0 } }
      : { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    if (!json.stream) {
      res.writeHead(200, { "content-type": "application/json", ...headers });
      return res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: json.model, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage }));
    }
    return sse([
      ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: json.model, content: [], stop_reason: null, stop_sequence: null, usage } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "想一想。" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-test" } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text } }],
      ["content_block_stop", { type: "content_block_stop", index: 1 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } }],
      ["message_stop", { type: "message_stop" }]
    ], headers);
  };
  const said = () => textOf(json.messages.filter((m) => m.role === "user").at(-1)?.content);
  const thinkingCount = () => json.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "thinking").length;
  const cached = () => (Boolean(json.cache_control) || JSON.stringify(json).includes('"cache_control"') ? "有" : "无");

  // The Claude box (claude-box/server.mjs) for the claude-code/… models, without Claude Code: it answers with a line
  // saying how much of the history came back as its own entries, and writes entries for the turn as the box does.
  // Asked to write in the notebook, it calls memory_notebook first, and answers once the result comes back; asked
  // "没话说" or "说两遍", what it writes then is "No response requested." or its first words again.
  // Where a box that redirects sends the resident: nothing should ever arrive here.
  if (url.pathname === "/claude-box-elsewhere/turn") {
    log.push({ kind: "claudebox.elsewhere", token: json.token, auth });
    return reply({ error: "not a box" }, 404);
  }
  if (url.pathname === "/claude-box/turn") {
    const items = (json.history ?? []).map((item) => (Array.isArray(item.entries) ? "entries" : item.role));
    // Her words, without what memory brought up after them.
    const promptText = (json.prompt ?? []).filter((b) => b.type === "text" && !b.text.startsWith("[Aelios 记忆]")).map((b) => b.text).join("\n");
    log.push({ kind: "claudebox.turn", token: json.token, model: json.model, effort: json.effort, thinking: json.thinking,
      system: json.system, items, prompt: json.prompt, history: json.history, tools: json.tools, auth });
    if (faults.claudeBox === "down") return reply({ error: "the box is restarting" }, 502);
    if (faults.claudeBox === "key") return reply({ error: "the box key does not match" }, 401);
    if (faults.claudeBox === "redirect") return reply({ error: "moved" }, 307, { location: "http://127.0.0.1:9999/claude-box-elsewhere/turn" });
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    const line = (obj) => res.write(`${JSON.stringify(obj)}\n`);
    if (String(json.token).includes("revoked")) {
      line({ error: "Claude Code returned an error result: Failed to authenticate. API Error: 401 OAuth access token is invalid." });
      return res.end();
    }
    const reused = items.filter((kind) => kind === "entries").length;
    const said = promptText.split("\n").at(-1).replace(/^\[[^\]]+\]\s*/, "");
    // Only results: the turn goes on from its calls. (Results with her next words follow a turn that ended at them.)
    const prompt = json.prompt ?? [];
    const result = prompt.length && prompt.every((b) => b.type === "tool_result") ? prompt[0] : undefined;
    const calls = !result && said.includes("记小本本") && (json.tools ?? []).some((t) => t.name === "memory_notebook");
    // What it writes after the result, chosen when it called (the result's call id says).
    const after = /^toolu_box_(quiet|again)_/.exec(String(result?.tool_use_id ?? ""))?.[1];
    const text = calls
      ? "我记一下。"
      : after
        ? (after === "quiet" ? "No response requested." : "我记一下。")
        : result
        ? `小本本记好了：${(result.content ?? []).map((b) => b.text).join("")}（接着 ${reused} 条，重写 ${items.length - reused} 条）`
        : `订阅收到：${said}（接着 ${reused} 条，重写 ${items.length - reused} 条）`;
    const usage = { input_tokens: 4, output_tokens: 0, cache_read_input_tokens: reused * 100, cache_creation_input_tokens: 50,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 50 } };
    const id = `msg_box_${log.length}`;
    line({ e: { type: "message_start", message: { id, type: "message", role: "assistant", model: json.model, content: [], stop_reason: null, stop_sequence: null, usage } } });
    if (json.thinking) {
      line({ e: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } } });
      line({ e: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "订阅里想一想。" } } });
      line({ e: { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-box" } } });
      line({ e: { type: "content_block_stop", index: 0 } });
    }
    const index = json.thinking ? 1 : 0;
    line({ e: { type: "content_block_start", index, content_block: { type: "text", text: "" } } });
    // In two pieces, as a stream comes.
    const half = Math.ceil(text.length / 2);
    line({ e: { type: "content_block_delta", index, delta: { type: "text_delta", text: text.slice(0, half) } } });
    line({ e: { type: "content_block_delta", index, delta: { type: "text_delta", text: text.slice(half) } } });
    if (said.includes("半路断")) {
      line({ error: "Claude Code returned an error result: API Error: 529 overloaded" });
      return res.end();
    }
    line({ e: { type: "content_block_stop", index } });
    const content = [{ type: "text", text }];
    if (calls) {
      const then = said.includes("没话说") ? "quiet_" : said.includes("说两遍") ? "again_" : "";
      const use = { type: "tool_use", id: `toolu_box_${then}${log.length}`, name: "memory_notebook", input: {} };
      const input = { action: "append", name: "测试", content: "今天学完第 30 章" };
      line({ e: { type: "content_block_start", index: index + 1, content_block: { ...use, caller: { type: "direct" } } } });
      // The input in pieces of JSON, as a stream brings it.
      const pieces = JSON.stringify(input);
      line({ e: { type: "content_block_delta", index: index + 1, delta: { type: "input_json_delta", partial_json: pieces.slice(0, 10) } } });
      line({ e: { type: "content_block_delta", index: index + 1, delta: { type: "input_json_delta", partial_json: pieces.slice(10) } } });
      line({ e: { type: "content_block_stop", index: index + 1 } });
      content.push({ ...use, name: "mcp__resident__memory_notebook", input });
    }
    line({ e: { type: "message_delta", delta: { stop_reason: calls ? "tool_use" : "end_turn", stop_sequence: null }, usage: { ...usage, output_tokens: 9 } } });
    line({ e: { type: "message_stop" } });
    const uuid = () => crypto.randomUUID();
    line({ done: {
      prompt: [{ type: "user", uuid: uuid(), message: { role: "user", content: json.prompt } }, { type: "attachment", uuid: uuid(), attachment: { type: "date", date: "2026-10-28" } }],
      reply: content.map((block) => ({ type: "assistant", uuid: uuid(), message: { id, type: "message", role: "assistant", model: json.model, content: [block] } }))
    } });
    return res.end();
  }
  if (url.pathname === "/custom/v1/chat/completions") {
    log.push({ kind: "custom.chat", auth: req.headers.authorization, body: json });
    return chat(`自己的供应商（OpenAI 格式）收到：${said()}`);
  }
  if (url.pathname === "/custom/v1/messages") {
    log.push({ kind: "custom.messages", apiKey: req.headers["x-api-key"], body: json });
    return messages(`自己的供应商（Anthropic 格式）收到 ${json.messages.length} 条，缓存标记${cached()}，旧思考块 ${thinkingCount()} 个`);
  }
  // Aelios' model list (what the web page's picker browses): a saved list, entries saying whether they get memory.
  const listed = url.pathname.match(/^(?:\/([^/]+))?\/v1\/models$/);
  if (listed && req.method === "GET") {
    log.push({ kind: "aelios.models", identity: listed[1] ?? null, auth });
    if (faults.models === "refuse") return reply({ error: { message: "Unauthorized" } }, 401);
    return reply({ object: "list", data: [
      { id: "chatgpt/gpt-5", object: "model", created: 0, owned_by: "chatgpt", aelios: { main: true } },
      { id: "openrouter/openai/gpt-6.1-sol:floor", object: "model", created: 0, owned_by: "openrouter", aelios: { main: false } },
      { id: "anthropic/claude-opus-5-5", object: "model", created: 0, owned_by: "anthropic", aelios: { main: true } }
    ] }, 200, { "x-aelios-models": "list" });
  }
  const gateway = url.pathname.match(/^(?:\/([^/]+))?\/v1\/(messages|chat\/completions)$/);
  if (gateway) {
    const purpose = req.headers["x-aelios-purpose"] ?? null;
    log.push({ kind: `aelios.${gateway[2] === "messages" ? "messages" : "chat"}`, identity: gateway[1] ?? null, purpose,
      apiKey: req.headers["x-api-key"], auth, body: json });
    // Like Aelios: a model needs its provider prefix; one outside the identity's main models gets no memory.
    // "dropped" stands for a model taken off the main list after it was picked: its trial call passed.
    if (!json.model.includes("/")) return reply({ error: { message: `"${json.model}" has no provider prefix; use the author/model form` } }, 400);
    const off = json.model.includes("plain") || (json.model.includes("dropped") && purpose !== "auxiliary");
    const memory = off ? "off" : purpose === "auxiliary" ? "skipped" : "injected";
    const headers = { "x-aelios-memory": memory };
    if (said().startsWith("(Not from them: time to write a handoff letter")) {
      if (faults.letterModel === "error") return reply({ error: { type: "api_error", message: "PRIVATE_UPSTREAM_DETAIL model unavailable" } }, 500);
      if (faults.letterModel === "empty") return messages("", headers);
      if (faults.letterModel === "slow") await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    if (gateway[2] === "messages") {
      return messages(`Aelios 收到 ${json.messages.length} 条，缓存标记${cached()}，旧思考块 ${thinkingCount()} 个`, headers);
    }
    return chat(`Aelios（${json.model}）收到：${said()}`, headers);
  }
  res.writeHead(404);
  res.end();
});
server.listen(9999, "127.0.0.1", () => console.log("mock on 9999"));
