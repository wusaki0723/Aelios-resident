// Unit tests for how the chat goes out through Aelios (src/via-aelios.ts). Usage: node test/via-aelios.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

mkdirSync("node_modules/.cache", { recursive: true });
const dir = mkdtempSync(join("node_modules/.cache", "resident-via-aelios-"));
const out = join(dir, "via-aelios.mjs");
await build({ entryPoints: ["src/via-aelios.ts", "src/thinking.ts"], bundle: true, platform: "node", format: "esm", outdir: dir, outExtension: { ".js": ".mjs" }, logLevel: "error" });
const { aeliosBase, aeliosModel, aeliosName, isAuxiliary, listModels, modelsOf, onMessages, takesCompletionTokens } = await import(pathToFileURL(join(process.cwd(), out)).href);
const { claudeOf, effortOf, withThinking } = await import(pathToFileURL(join(process.cwd(), dir, "thinking.mjs")).href);
rmSync(dir, { recursive: true, force: true });

// One at a time: the async ones swap globalThis.fetch.
let queue = Promise.resolve();
function test(name, fn) {
  queue = queue.then(async () => {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      console.log(`FAIL ${name}: ${error.message}`);
      process.exitCode = 1;
    }
  });
}

const note = "(Not from them: a scheduled check-in; it is now 10-15 09:00.) If you would like to reach out…";
const hers = "[10-15 09:01 周四] 早";

test("names: what was picked or typed goes to Aelios as it is; only a bare Workers AI id goes under workers-ai/", () => {
  assert.equal(aeliosName("@cf/zai-org/glm-4.7-flash"), "workers-ai/@cf/zai-org/glm-4.7-flash");
  assert.equal(aeliosName("workers-ai/@cf/zai-org/glm-4.7-flash"), "workers-ai/@cf/zai-org/glm-4.7-flash");
  for (const id of ["anthropic/claude-opus-5.5", "anthropic/claude-opus-5-5", "anthropic/claude-haiku-4.5-20251001",
    "custom-relay/anthropic/claude-sonnet-4.5", "custom-nous/hermes", "openai/gpt-6.1-terra"]) {
    assert.equal(aeliosName(id), id);
  }
});

test("the model goes to Aelios under exactly the name it was picked by", async () => {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body).model);
    return Response.json({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
  };
  try {
    const memory = { url: "https://a.example", key: "k", namespace: "default", identity: "" };
    for (const id of ["anthropic/claude-opus-5.5", "anthropic/claude-opus-5-5"]) {
      await aeliosModel(memory, id, { auxiliary: true }).doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "ok" }] }] });
    }
    assert.deepEqual(sent, ["anthropic/claude-opus-5.5", "anthropic/claude-opus-5-5"]);
  } finally { globalThis.fetch = real; }
});

test("Messages for anthropic/ and anything with claude in it; chat completions for the rest", () => {
  assert.equal(onMessages("anthropic/claude-opus-5.5"), true);
  assert.equal(onMessages("Anthropic/claude-opus-5.5"), true);
  assert.equal(onMessages("custom-nous/claude-sonnet-5.5"), true);
  assert.equal(onMessages("custom-relay/anthropic/Claude-Opus-5.5"), true);
  assert.equal(onMessages("openai/gpt-5"), false);
  assert.equal(onMessages("custom-nous/hermes"), false);
  assert.equal(onMessages("@cf/zai-org/glm-4.7-flash"), false);
});

test("OpenAI's own reasoning models take max_completion_tokens; other models and other providers keep max_tokens", () => {
  for (const name of ["openai/gpt-5.5", "openai/gpt-5", "openai/gpt-5-mini", "openai/gpt-5.1-chat-latest", "openai/gpt-6", "openai/o3", "openai/o4-mini", "OpenAI/GPT-5.5"]) {
    assert.equal(takesCompletionTokens(name), true, name);
  }
  for (const name of ["openai/gpt-5-chat-latest", "openai/gpt-4.1", "openai/gpt-4o", "openai/omni-moderation", "openrouter/openai/gpt-5.5", "custom-relay/gpt-5.5", "chatgpt/gpt-5.5", "gpt-5.5"]) {
    assert.equal(takesCompletionTokens(name), false, name);
  }
});

test("the output cap goes to OpenAI's reasoning models as max_completion_tokens, to the others as max_tokens", async () => {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    const message = { role: "assistant", content: "ok" };
    return Response.json({ id: "c", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, message, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  };
  try {
    const memory = { url: "https://a.example", key: "k", namespace: "default", identity: "" };
    const call = (id) => aeliosModel(memory, id, { auxiliary: true }).doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "ok" }] }], maxOutputTokens: 64 });
    await call("openai/gpt-5.5");
    await call("openai/gpt-4.1");
    assert.equal(sent[0].max_completion_tokens, 64);
    assert.equal("max_tokens" in sent[0], false);
    assert.equal(sent[1].max_tokens, 64);
    assert.equal("max_completion_tokens" in sent[1], false);
  } finally { globalThis.fetch = real; }
});

test("the address: /v1 for the key's first identity, /<identity>/v1 for a named one", () => {
  assert.equal(aeliosBase({ url: "https://a.example", key: "k", namespace: "default", identity: "" }), "https://a.example/v1");
  assert.equal(aeliosBase({ url: "https://a.example", key: "k", namespace: "default", identity: "resident" }), "https://a.example/resident/v1");
});

test("her message is hers, on Messages and on chat completions", () => {
  assert.equal(isAuxiliary({ messages: [{ role: "user", content: [{ type: "text", text: hers }] }] }), false);
  assert.equal(isAuxiliary({ messages: [{ role: "system", content: "persona" }, { role: "user", content: hers }] }), false);
});

test("a check-in or letter turn is auxiliary, also after a tool call within it", () => {
  assert.equal(isAuxiliary({ messages: [{ role: "user", content: [{ type: "text", text: hers }] }, { role: "assistant", content: "嗯" }, { role: "user", content: note }] }), true);
  const toolLoop = [
    { role: "user", content: [{ type: "text", text: note }] },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "web_search", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "…" }] }
  ];
  assert.equal(isAuxiliary({ messages: toolLoop }), true);
  // The same tool loop in her turn stays hers.
  assert.equal(isAuxiliary({ messages: [{ ...toolLoop[0], content: [{ type: "text", text: hers }] }, ...toolLoop.slice(1)] }), false);
  // Chat completions put tool results under their own role.
  assert.equal(isAuxiliary({ messages: [{ role: "user", content: note }, { role: "assistant", tool_calls: [] }, { role: "tool", content: "…" }] }), true);
});

test("the older Chinese note is recognised too", () => {
  assert.equal(isAuxiliary({ messages: [{ role: "user", content: "（这条不是她发的，是定时提醒）" }] }), true);
});

test("thinking: read from the model name; older names and other models are not Claude versions", () => {
  assert.deepEqual(claudeOf("anthropic/claude-opus-5-5"), { family: "opus", version: 5.5 });
  assert.deepEqual(claudeOf("custom-relay/anthropic/claude-sonnet-4.5"), { family: "sonnet", version: 4.5 });
  assert.deepEqual(claudeOf("claude-haiku-4-5-20251001"), { family: "haiku", version: 4.5 });
  assert.deepEqual(claudeOf("claude-opus-5-20260101"), { family: "opus", version: 5 });
  assert.equal(claudeOf("claude-3-7-sonnet-20250219"), null);
  assert.equal(claudeOf("anthropic/claude-test"), null);
  assert.equal(effortOf(" High "), "high");
  assert.equal(effortOf("auto"), null);
  assert.equal(effortOf(undefined), null);
});

test("thinking: shown on the models that hide it, effort only where it is taken", () => {
  const shown = { type: "adaptive", display: "summarized" };
  assert.deepEqual(withThinking({ model: "anthropic/claude-opus-5-5" }, null), { model: "anthropic/claude-opus-5-5", thinking: shown });
  assert.deepEqual(withThinking({ model: "claude-haiku-5-5" }, "low"), { model: "claude-haiku-5-5", thinking: shown, output_config: { effort: "low" } });
  // Thinks only when asked: no thinking switched on, but effort is taken.
  assert.deepEqual(withThinking({ model: "claude-opus-4-6" }, "max"), { model: "claude-opus-4-6", output_config: { effort: "max" } });
  // Takes neither.
  assert.deepEqual(withThinking({ model: "claude-sonnet-4-5" }, "high"), { model: "claude-sonnet-4-5" });
  assert.deepEqual(withThinking({ model: "openai/gpt-5" }, "high"), { model: "openai/gpt-5" });
  // What the request already says is kept.
  assert.deepEqual(withThinking({ model: "claude-fable-5-1", thinking: { type: "adaptive", display: "omitted" } }, null).thinking, { type: "adaptive", display: "omitted" });
  assert.deepEqual(withThinking({ model: "claude-opus-5-5", output_config: { format: { type: "json_schema" } } }, "high").output_config, { format: { type: "json_schema" }, effort: "high" });
});

test("Aelios' model list: an id once, who it is from, and whether it gets memory only when Aelios says", () => {
  const body = { object: "list", data: [
    { id: "openai/gpt-5", object: "model", owned_by: "openai", aelios: { main: true } },
    { id: "custom-mine/tiny", owned_by: "custom-mine", aelios: { main: false } },
    { id: "chatgpt/gpt-5", aelios: {} },
    { id: "openai/gpt-5", owned_by: "openai" },
    { id: "has space" }, { id: "" }, { id: 7 }, { nope: true }, null, "text",
    { id: "x".repeat(201) },
    { id: "anthropic/claude-opus-5-5", owned_by: 7, aelios: { main: "yes" } }
  ] };
  assert.deepEqual(modelsOf(body), [
    { id: "openai/gpt-5", owner: "openai", main: true },
    { id: "custom-mine/tiny", owner: "custom-mine", main: false },
    { id: "chatgpt/gpt-5", owner: "" },
    { id: "anthropic/claude-opus-5-5", owner: "" }
  ]);
  for (const nothing of [null, undefined, "x", [], {}, { data: "x" }]) assert.deepEqual(modelsOf(nothing), []);
  assert.equal(modelsOf({ data: Array.from({ length: 6000 }, (_, i) => ({ id: `m/${i}` })) }).length, 5000);
});

test("listModels asks Aelios' model endpoint under the identity with the key, and says whether the owner saved a list", async () => {
  const real = globalThis.fetch;
  const asked = [];
  let answer = () => new Response(JSON.stringify({ data: [{ id: "chatgpt/gpt-5", owned_by: "chatgpt", aelios: { main: true } }] }), { headers: { "x-aelios-models": "list" } });
  globalThis.fetch = async (url, init) => { asked.push({ url: String(url), auth: new Headers(init.headers).get("authorization") }); return answer(); };
  try {
    const named = { url: "https://a.example", key: "k1", namespace: "default", identity: "res" };
    assert.deepEqual(await listModels(named), { models: [{ id: "chatgpt/gpt-5", owner: "chatgpt", main: true }], curated: true });
    assert.deepEqual(asked, [{ url: "https://a.example/res/v1/models", auth: "Bearer k1" }]);
    asked.length = 0;
    answer = () => new Response(JSON.stringify({ data: [{ id: "openai/gpt-5" }] }), { headers: { "x-aelios-models": "upstream" } });
    assert.deepEqual(await listModels({ ...named, identity: "" }), { models: [{ id: "openai/gpt-5", owner: "" }], curated: false });
    assert.equal(asked[0].url, "https://a.example/v1/models");
    answer = () => new Response(JSON.stringify({ data: [] }));
    assert.equal((await listModels(named)).curated, false, "no header, not curated");
    answer = () => new Response("nope", { status: 401 });
    await assert.rejects(listModels(named), /Aelios answered 401/);
    answer = () => new Response("<html>", { status: 200 });
    await assert.rejects(listModels(named));
  } finally { globalThis.fetch = real; }
});

test("a reply asked for again goes to Aelios with a request id of its own, so it is recorded as a new exchange", async () => {
  const real = globalThis.fetch;
  const ids = [];
  globalThis.fetch = async (_url, init) => {
    ids.push(new Headers(init.headers).get("x-aelios-request-id"));
    const message = { role: "assistant", content: "好" };
    return Response.json({ id: "c", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, message, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  };
  try {
    let redo = null;
    const model = aeliosModel({ url: "https://a.example", key: "k", namespace: "default", identity: "" }, "openai/gpt-5", { redo: () => redo });
    const call = () => model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: hers }] }] });
    await call();
    redo = "again-1";
    await call();
    assert.deepEqual(ids, [null, "again-1"]);
  } finally { globalThis.fetch = real; }
});
