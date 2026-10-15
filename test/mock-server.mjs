// Stands in for the Telegram Bot API and Aelios during local tests. Records every call.
import http from "node:http";

const log = [];
let nextMessageId = 1000;

const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const json = body ? JSON.parse(body) : undefined;
  const url = new URL(req.url, "http://x");
  const reply = (obj, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === "/__log") return reply(log);
  if (url.pathname === "/__reset") {
    log.length = 0;
    return reply({ ok: true });
  }

  // A file the bot downloads after getFile: a few bytes that start like a JPEG.
  const file = url.pathname.match(/^\/file\/bot[^/]+\/(.+)$/);
  if (file) {
    log.push({ kind: "tg.file", path: file[1] });
    res.writeHead(200, { "content-type": "image/jpeg" });
    return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]));
  }

  const tg = url.pathname.match(/^\/bot[^/]+\/(\w+)$/);
  if (tg) {
    const method = tg[1];
    log.push({ kind: `tg.${method}`, body: json });
    const chat = { id: Number(json?.chat_id ?? 42), type: "private" };
    const message = () => ({ message_id: nextMessageId++, date: Math.floor(Date.now() / 1000), chat, text: json?.text });
    switch (method) {
      case "getMe":
        return reply({ ok: true, result: { id: 777, is_bot: true, first_name: "Resident", username: "resident_test_bot" } });
      case "sendMessage":
      case "editMessageText":
        return reply({ ok: true, result: message() });
      case "getFile":
        // "gone" stands for a file Telegram no longer has.
        if (json?.file_id === "gone") return reply({ ok: false, error_code: 400, description: "Bad Request: invalid file_id" }, 400);
        return reply({ ok: true, result: { file_id: json?.file_id, file_path: `photos/${json?.file_id}.jpg` } });
      case "sendChatAction":
      case "setWebhook":
      case "setMyCommands":
      case "setChatMenuButton":
        return reply({ ok: true, result: true });
      default:
        // e.g. sendRichMessage: an older Bot API, so the adapter falls back to sendMessage.
        return reply({ ok: false, error_code: 404, description: "Not Found: method not found" }, 404);
    }
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
    const text = JSON.stringify({ data: { id: "mem-new", created: true } });
    return reply({ jsonrpc: "2.0", id: json.id, result: { content: [{ type: "text", text }] } });
  }
  if (url.pathname === "/v1/memory/ingest") {
    log.push({ kind: "aelios.ingest", body: json, auth });
    return reply({ data: { conversation_id: json.conversation_id, message_ids: [] } });
  }
  if (url.pathname === "/v1/precious") {
    log.push({ kind: "aelios.precious", body: json, auth });
    return reply({ data: { id: "p1", content: json.content } }, 201);
  }
  if (url.pathname === "/v1/memory_boot") {
    log.push({ kind: "aelios.boot", query: url.search, auth });
    return reply({
      data: {
        daily_log: { title: "闲聊日", summary: "昨天你们聊了周末去哪儿玩。" },
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
    const usage = { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
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

  if (url.pathname === "/custom/v1/chat/completions") {
    log.push({ kind: "custom.chat", auth: req.headers.authorization, body: json });
    return chat(`自己的供应商（OpenAI 格式）收到：${said()}`);
  }
  if (url.pathname === "/custom/v1/messages") {
    log.push({ kind: "custom.messages", apiKey: req.headers["x-api-key"], body: json });
    return messages(`自己的供应商（Anthropic 格式）收到 ${json.messages.length} 条，缓存标记${cached()}，旧思考块 ${thinkingCount()} 个`);
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
    if (gateway[2] === "messages") {
      return messages(`Aelios 收到 ${json.messages.length} 条，缓存标记${cached()}，旧思考块 ${thinkingCount()} 个`, headers);
    }
    return chat(`Aelios（${json.model}）收到：${said()}`, headers);
  }
  res.writeHead(404);
  res.end();
});
server.listen(9999, "127.0.0.1", () => console.log("mock on 9999"));
