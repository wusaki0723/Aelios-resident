#!/usr/bin/env node
// A pretend ACP helper for the tests. It speaks the protocol on stdio and acts out what the prompt text says:
//   SLOW       waits until session/cancel, then ends the turn "cancelled"
//   SLEEP:n    works for n ms, then finishes
//   ASKME      ends with the ASK: line
//   QUESTION   ends with a plain question (no marker)
//   CRASH      dies mid-turn
//   PERM:kind[:path]   asks permission first and says what it was told
//   CWD        says the folder it was started in
// It wears two faces, picked by how it is started: `acp` (Kiro: session/load) or `--profile acp` (DSH: session/resume + close).
// Everything it is asked is appended to the file in FAKE_STORE, which also keeps its sessions between runs.
import fs from "node:fs";
import readline from "node:readline";

const args = process.argv.slice(2);
const dsh = args.join(" ") === "--profile acp";
if (!dsh && args[0] !== "acp") process.exit(64);
const file = process.env.FAKE_STORE;
const load = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { sessions: {}, log: [], n: 0 }; } };
const store = patch => { const data = load(); patch(data); fs.writeFileSync(file, JSON.stringify(data)); return data; };
const send = message => process.stdout.write(JSON.stringify(message) + "\n");
const chunk = (sessionId, text) => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const waiting = new Map(); // requests we sent to the client
let nextId = 1000;
const cancelled = new Set(); const cancelWaiters = new Map();
const ask = (method, params) => new Promise(resolve => { const id = nextId++; waiting.set(id, resolve); send({ jsonrpc: "2.0", id, method, params }); });

store(data => data.log.push({ event: "start", args }));
process.stdout.write("this line is not JSON, a client must skip it\n");

async function prompt(id, params) {
  const { sessionId } = params, full = params.prompt.map(part => part.text).join(""), text = full.split("\n\nOnly if you")[0];
  const session = load().sessions[sessionId];
  store(data => data.log.push({ event: "prompt", sessionId, text, full, cwd: session?.cwd }));
  chunk(sessionId, "starting. ");
  send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "look around", kind: "read" } } });
  if (text.includes("CRASH")) process.exit(3);
  if (text.includes("SLOW")) {
    chunk(sessionId, "partial work");
    if (!cancelled.has(sessionId)) await new Promise(resolve => { cancelWaiters.set(sessionId, resolve); setTimeout(resolve, 30_000); });
    cancelled.delete(sessionId);
    return send({ jsonrpc: "2.0", id, result: { stopReason: "cancelled" } });
  }
  const sleeping = /SLEEP:(\d+)/.exec(text);
  if (sleeping) await sleep(Number(sleeping[1]));
  let said = "";
  const perm = /PERM:(\w+)(?::(\S+))?/.exec(text);
  if (perm) {
    const outcome = await ask("session/request_permission", { sessionId,
      toolCall: { toolCallId: "t2", title: `do ${perm[1]} ${perm[2] ?? ""}`.trim(), kind: perm[1], status: "pending", locations: perm[2] ? [{ path: perm[2] }] : [] },
      options: [{ optionId: "always", name: "Always", kind: "allow_always" }, { optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "reject", name: "Reject", kind: "reject_once" }] });
    said = ` perm=${outcome.outcome?.optionId ?? outcome.outcome?.outcome}`;
  }
  const long = /LONG:(\d+)/.exec(text);
  if (long) said += " " + "字".repeat(Number(long[1]));
  if (text.includes("CWD")) said += ` cwd=${session?.cwd}`;
  chunk(sessionId, text.includes("ASKME") ? "我需要你定一下。\nASK: 我先做哪一个？" : text.includes("QUESTION") ? "做完了，要我继续吗？" : `done: ${text}${said}`);
  send({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } });
}

readline.createInterface({ input: process.stdin }).on("line", async line => {
  const message = JSON.parse(line);
  if (message.method === undefined) return waiting.get(message.id)?.(message.result ?? {}), waiting.delete(message.id);
  const { id, method, params } = message;
  const reply = result => send({ jsonrpc: "2.0", id, result });
  if (method === "session/cancel") { store(data => data.log.push({ event: method, sessionId: params.sessionId })); cancelled.add(params.sessionId); cancelWaiters.get(params.sessionId)?.(); return; }
  store(data => data.log.push({ event: method, sessionId: params?.sessionId, cwd: params?.cwd, caps: params?.clientCapabilities }));
  if (method === "initialize") return reply({ protocolVersion: 1, agentCapabilities: dsh ? { sessionCapabilities: { resume: {}, close: {} } } : { loadSession: true }, authMethods: [] });
  if (method === "session/new") {
    const data = store(d => { d.n += 1; d.sessions[`sess-${d.n}`] = { cwd: params.cwd }; });
    return reply({ sessionId: `sess-${data.n}` });
  }
  if (method === "session/load" || method === "session/resume") {
    if (!load().sessions[params.sessionId]) return send({ jsonrpc: "2.0", id, error: { code: -32002, message: "session not found" } });
    if (method === "session/load") chunk(params.sessionId, "OLD HISTORY replayed on load");
    return reply({});
  }
  if (method === "session/close") return reply({});
  if (method === "session/prompt") return prompt(id, params);
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
});
