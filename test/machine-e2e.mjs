// End to end: the local Worker, the real runner (runner/) and a pretend ACP helper (runner/test/fake-agent.mjs).
// A job the resident sends goes to the machine and its words come back to the thread; her words to a running thread
// stop the turn and go into the same session; an ASK: line makes the thread wait for her, and her answer resolves it.
// The resident only gets a record of it (a note), never a turn of its own.
// Needs the Worker and the mock server, like test/run.mjs (a fresh Worker: delete .wrangler/state first):
//   node test/mock-server.mjs & NO_PROXY=127.0.0.1 npx wrangler dev --config wrangler.test.jsonc --port 8787 &
//   NO_PROXY=127.0.0.1 node test/machine-e2e.mjs
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const WORKER = "http://127.0.0.1:8787";
const KEY = "test-web-key";
const RUNNER = path.resolve("runner/bin/aelios-runner.mjs");
const AGENT = path.resolve("runner/test/fake-agent.mjs");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const web = async (route, body) => {
  const response = await fetch(`${WORKER}${route}`, { method: body ? "POST" : "GET", headers: { "x-web-key": KEY, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
};
async function until(check, what, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
}
let failed = false;
async function step(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failed = true; console.log(`FAIL ${name}: ${error.stack}`); }
}

const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "machine-e2e-")));
const store = path.join(home, "agent.json");
writeFileSync(store, JSON.stringify({ sessions: {}, log: [], n: 0 }));
const env = { ...process.env, AELIOS_RUNNER_HOME: path.join(home, "runner"), FAKE_STORE: store };
const prompts = () => JSON.parse(readFileSync(store, "utf8")).log.filter((e) => e.event === "prompt");
const assistantLines = async () => (await web("/web/messages")).data.data.filter((line) => line.role === "assistant").length;
const threadOf = async (id) => (await web(`/web/thread?id=${id}`)).data;
/** Sent from the web page; the newest machine thread afterwards. */
async function send(text) {
  const before = new Set((await web("/web/threads")).data.threads.map((t) => t.id));
  assert.equal((await web("/web/say", { text })).status, 200);
  return until(async () => (await web("/web/threads")).data.threads.find((t) => t.runs === "machine" && !before.has(t.id)), "a new machine thread");
}
let runner;

try {
  await step("turned on and paired with a one-time code from the settings page; offline until the runner starts", async () => {
    assert.equal((await web("/web/config", { key: "CLOUD_TASKS", text: "on" })).status, 200);
    assert.equal((await web("/web/runner")).data.machine, null);
    const { data } = await web("/web/runner/code", {});
    assert.match(data.code, /^pc_[0-9a-f]{20}$/);
    execFileSync(process.execPath, [RUNNER, "pair", "--code", data.code, "--url", WORKER, "--workspace", path.join(home, "work"), "--access", "edit", "--plugin", "command", "--command", JSON.stringify([AGENT, "acp"])], { env });
    const config = path.join(home, "runner", "config.json");
    writeFileSync(config, JSON.stringify({ ...JSON.parse(readFileSync(config, "utf8")), pollMs: 200, heartbeatMs: 500 }));
    const shown = (await web("/web/runner")).data.machine;
    assert.equal(shown.online, false);
    // Offline: the resident is told at once, nothing waits in a queue.
    assert.equal((await web("/web/say", { text: "机器派活 不该排队" })).status, 200);
    const said = (await web("/web/messages")).data.data.filter((line) => line.role === "assistant").at(-1).text;
    assert.match(said, /不在线/);
    assert.ok(!(await web("/web/threads")).data.threads.some((t) => t.runs === "machine"));
    runner = spawn(process.execPath, [RUNNER, "start"], { env, stdio: ["ignore", "ignore", "pipe"] });
    await until(async () => (await web("/web/runner")).data.machine?.online, "the machine online");
  });

  let first;
  await step("a job the resident sends runs on the machine; the thread shows its own words; the resident gets a record, not a turn", async () => {
    first = await send("机器派活 做完它");
    const replies = await assistantLines();
    const done = await until(async () => { const t = await threadOf(first.id); return t.status === "done" && t; }, "done");
    const reply = done.lines.find((line) => line.role === "result");
    assert.match(reply.text, /done: 做完它/);
    assert.equal(prompts()[0].text, "做完它", "only the job goes to the helper");
    await sleep(1500);
    assert.equal(await assistantLines(), replies, "no turn of the resident's to retell it");
    // The record is in its conversation (the model sees it), not on her page.
    assert.equal((await web("/web/say", { text: "机器记录几条" })).status, 200);
    const lines = (await web("/web/messages")).data.data;
    assert.equal(lines.filter((line) => line.role === "assistant").at(-1).text, "机器记录 1 条");
    assert.ok(!JSON.stringify(lines).includes("ran on their machine"), "not shown to her");
  });

  await step("her words to a running thread stop the turn and go into the same session; the reply is the thread's own", async () => {
    const t = await send("机器派活 SLOW 长活");
    await until(async () => (await threadOf(t.id)).status === "working", "working");
    await until(() => prompts().some((p) => p.text === "SLOW 长活"), "the slow turn started");
    const said = await web("/web/thread/say", { id: t.id, text: "换个做法" });
    assert.equal(said.status, 200, JSON.stringify(said.data));
    const thread = await until(async () => { const v = await threadOf(t.id); return v.status === "done" && v.tasks.length === 2 && v; }, "her words answered");
    assert.deepEqual(thread.tasks.map((task) => task.status), ["failed", "done"], "the interrupted turn, then hers");
    assert.match(thread.lines.at(-1).text, /done: 换个做法/);
    const [slow, hers] = prompts().slice(-2);
    assert.equal(slow.sessionId, hers.sessionId, "the same session");
    assert.ok(JSON.parse(readFileSync(store, "utf8")).log.some((e) => e.event === "session/cancel"));
  });

  await step("an ASK: line makes the thread wait for her with its question kept; her answer resolves it", async () => {
    const t = await send("机器派活 ASKME 选哪个");
    const asked = await until(async () => { const v = await threadOf(t.id); return v.status === "needs_you" && v; }, "needs_you");
    assert.equal(asked.tasks.at(-1).waiting, true);
    assert.equal(asked.asks.length, 1);
    assert.equal(asked.asks[0].question, "我先做哪一个？");
    assert.ok((await web("/web/threads")).data.threads.find((x) => x.id === t.id).waiting);
    assert.equal((await web("/web/thread/say", { id: t.id, text: "先做 A" })).status, 200);
    const answered = await until(async () => { const v = await threadOf(t.id); return v.status === "done" && v; }, "answered");
    assert.deepEqual(answered.asks, [], "resolved");
    assert.equal((await web("/web/threads")).data.threads.find((x) => x.id === t.id).waiting, false);
  });

  await step("the resident's own follow-up is mailed to the same session", async () => {
    assert.equal((await web("/web/say", { text: `机器接着派 ${first.id} 再看一遍` })).status, 200);
    const thread = await until(async () => { const v = await threadOf(first.id); return v.tasks.length === 2 && v.status === "done" && v; }, "follow-up done");
    assert.match(thread.lines.at(-1).text, /done: 再看一遍/);
    const sessions = prompts().filter((p) => p.text === "做完它" || p.text === "再看一遍").map((p) => p.sessionId);
    assert.equal(new Set(sessions).size, 1);
  });

  await step("revoked from the settings page: the runner is told 401 and stops", async () => {
    const id = (await web("/web/runner")).data.machine.id;
    assert.equal((await web("/web/runner/revoke", { runnerId: id })).status, 200);
    await until(() => runner.exitCode !== null, "the runner to exit", 15_000);
    assert.equal((await web("/web/runner")).data.machine, null);
  });
} finally {
  runner?.kill("SIGKILL");
  rmSync(home, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
