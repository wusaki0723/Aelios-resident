// The runner against a pretend resident (fake-cloud.mjs) and a pretend ACP helper (fake-agent.mjs).
// Every case runs once per plug (kiro, dsh): the plug only changes how the helper is started.
// Run: node --test --test-concurrency=1 test/
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CloudError, register } from "../src/cloud.mjs";
import { Runner } from "../src/runner.mjs";
import { StateFile } from "../src/state.mjs";
import { FakeCloud } from "./fake-cloud.mjs";

const AGENT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-agent.mjs");
chmodSync(AGENT, 0o755);

async function rig(plugin, extra = {}) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "runner-test-")));
  const cloud = await new FakeCloud().listen();
  const store = path.join(dir, "agent.json");
  writeFileSync(store, JSON.stringify({ sessions: {}, log: [], n: 0 }));
  const workspace = path.join(dir, "work");
  const config = { url: cloud.url, resident: "default", workspace, access: "edit", plugin, bin: AGENT, env: { FAKE_STORE: store },
    pollMs: 20, heartbeatMs: 20, killAfterMs: 400, ...extra };
  const state = new StateFile(path.join(dir, "state.json"));
  await state.update(s => { s.device = { runnerId: "run_1", token: cloud.deviceToken }; });
  const rig = { dir, cloud, state, config, workspace, store, stopped: false };
  rig.log = () => JSON.parse(readFileSync(store, "utf8")).log;
  rig.prompts = () => rig.log().filter(e => e.event === "prompt");
  rig.start = () => {
    rig.control = new AbortController();
    rig.runner = new Runner({ config, state });
    rig.loop = rig.runner.start(rig.control.signal);
  };
  rig.stop = async () => { if (rig.control && !rig.stopped) { rig.stopped = true; rig.control.abort(); await rig.loop; } };
  rig.done = async () => { await rig.stop(); await cloud.close(); rmSync(dir, { recursive: true, force: true }); };
  return rig;
}
const final = (r, work) => r.cloud.until(() => r.cloud.finals(work.workId)[0], "final of " + work.workId);

for (const plugin of ["kiro", "dsh"]) {
  const t = (name, fn) => test(`[${plugin}] ${name}`, async () => { const r = await rig(plugin); try { await fn(r); } finally { await r.done(); } });

  t("a new thread: new session, fixed folder, started then final, the prompt is the instruction and nothing else", async r => {
    r.start();
    const work = r.cloud.push({ text: "hello CWD", cwd: "/etc", agent: "claude", command: ["rm"], access: undefined });
    const done = await final(r, work);
    assert.equal(done.status, "done");
    assert.match(done.summary, /done: hello CWD/);
    assert.ok(done.summary.includes(`cwd=[workspace]`), "the folder is not shown");
    const started = r.cloud.got(work.workId, "started")[0];
    assert.equal(started.sessionId, "sess-1");
    const [prompt] = r.prompts();
    assert.equal(prompt.text, "hello CWD");
    assert.equal(prompt.cwd, r.workspace, "extra fields from the cloud do not choose the folder");
    const init = r.log().find(e => e.event === "initialize");
    assert.deepEqual(init.caps, {}, "no file or terminal capability is offered");
    assert.deepEqual(r.log().find(e => e.event === "start").args, plugin === "dsh" ? ["--profile", "acp"] : ["acp"]);
    const saved = (await r.state.read()).threads.t_main;
    assert.deepEqual([saved.sessionId, saved.cwd], ["sess-1", r.workspace]);
  });

  t("a later job in the thread goes back into the same session", async r => {
    r.start();
    await final(r, r.cloud.push({ text: "first" }));
    const second = r.cloud.push({ text: "second" });
    const done = await final(r, second);
    assert.equal(done.status, "done");
    assert.ok(!done.summary.includes("OLD HISTORY"), "history replayed while reopening is not the answer");
    const log = r.log();
    assert.equal(log.filter(e => e.event === "session/new").length, 1);
    const reopen = log.find(e => e.event === (plugin === "dsh" ? "session/resume" : "session/load"));
    assert.equal(reopen.sessionId, "sess-1");
    assert.deepEqual(r.prompts().map(p => [p.sessionId, p.text]), [["sess-1", "first"], ["sess-1", "second"]]);
  });

  t("a session the helper no longer has: a new one is opened and the work still runs", async r => {
    r.start();
    await final(r, r.cloud.push({ text: "first" }));
    writeFileSync(r.store, JSON.stringify({ ...JSON.parse(readFileSync(r.store, "utf8")), sessions: {} }));
    const done = await final(r, r.cloud.push({ text: "second" }));
    assert.equal(done.status, "done");
    assert.equal(r.log().filter(e => e.event === "session/new").length, 2);
  });

  t("cancel stops the running turn; it ends cancelled and the thread can go on", async r => {
    r.start();
    const slow = r.cloud.push({ text: "SLOW job" });
    await r.cloud.until(() => r.cloud.got(slow.workId, "started")[0], "started");
    const cancel = r.cloud.push({ kind: "cancel", text: undefined });
    assert.equal((await final(r, cancel)).status, "done");
    const done = await final(r, slow);
    assert.equal(done.status, "cancelled");
    assert.ok(r.log().some(e => e.event === "session/cancel" && e.sessionId === "sess-1"));
    const after = await final(r, r.cloud.push({ text: "again" }));
    assert.equal(after.status, "done");
  });

  t("the user speaks to the thread: the turn stops and the words go into the same session", async r => {
    r.start();
    const slow = r.cloud.push({ text: "SLOW job" });
    await r.cloud.until(() => r.cloud.got(slow.workId, "started")[0], "started");
    const say = r.cloud.push({ kind: "say", text: "no, do this instead" });
    assert.equal((await final(r, slow)).status, "cancelled");
    const done = await final(r, say);
    assert.equal(done.status, "done");
    assert.match(done.summary, /done: no, do this instead/);
    assert.deepEqual(r.prompts().map(p => p.sessionId), ["sess-1", "sess-1"]);
  });

  t("a letter in the mailbox waits for the running turn, tells the cloud it is queued, then runs in order", async r => {
    r.start();
    const first = r.cloud.push({ text: "SLEEP:300 first" });
    await r.cloud.until(() => r.cloud.got(first.workId, "started")[0], "started");
    const mail = r.cloud.push({ kind: "mail", text: "second" });
    await r.cloud.until(() => r.cloud.got(mail.workId, "queued")[0], "queued receipt");
    assert.equal(r.cloud.got(first.workId, "final").length, 0, "the running turn was not interrupted");
    assert.equal((await final(r, mail)).status, "done");
    assert.deepEqual(r.prompts().map(p => p.text), ["SLEEP:300 first", "second"]);
    const order = r.cloud.accepted.map(x => `${x.workId}:${x.type}`);
    assert.ok(order.indexOf(`${first.workId}:final`) < order.indexOf(`${mail.workId}:started`));
  });

  t("a question from the helper is needs_you with an ask, and the next finished turn resolves it", async r => {
    r.start();
    const asked = await final(r, r.cloud.push({ text: "ASK which one" }));
    assert.equal(asked.status, "needs_you");
    assert.match(asked.ask.key, /^q:/);
    assert.match(asked.ask.question, /我先做哪一个/);
    const next = await final(r, r.cloud.push({ kind: "say", text: "the first one" }));
    assert.equal(next.status, "done");
    assert.deepEqual(next.resolve, [asked.ask.key]);
  });

  const perm = async (r, text, extra = {}) => { r.start(); return final(r, r.cloud.push({ text, ...extra })); };

  t("permissions, tier edit: an edit inside the folder is allowed, one outside is turned down and asked about", async r => {
    const inside = await perm(r, `PERM:edit:${path.join(os.tmpdir(), "not-yet")}`);
    assert.equal(inside.status, "needs_you", "outside the folder");
    assert.match(inside.ask.question, /编辑的位置不在工作目录里/);
    assert.match(inside.summary, /perm=reject/);
    const ok = await final(r, r.cloud.push({ text: `PERM:edit:${path.join(r.workspace, "a.txt")}` }));
    assert.equal(ok.status, "done");
    assert.match(ok.summary, /perm=allow/, "only the one-time option is ever chosen");
    const run = await final(r, r.cloud.push({ text: "PERM:execute" }));
    assert.equal(run.status, "needs_you");
  });

  t("permissions: the job can lower the tier but never raise it", async r => {
    const lowered = await perm(r, "PERM:execute", { access: "full" });
    assert.equal(lowered.status, "needs_you", "config is edit; the job asking for full changes nothing");
    const full = await rig(plugin, { access: "full" });
    try {
      full.start();
      const ok = await final(full, full.cloud.push({ text: "PERM:execute" }));
      assert.equal(ok.status, "done");
      const down = await final(full, full.cloud.push({ text: "PERM:execute", access: "read" }));
      assert.equal(down.status, "needs_you");
      const start = full.log().find(e => e.event === "start");
      if (plugin === "kiro") assert.ok(start.args.includes("--trust-all-tools"));
    } finally { await full.done(); }
  });

  t("a line that drops after the cloud took the receipt: it is sent again, taken once, and the helper ran once", async r => {
    r.cloud.drops.receipt = 2; // the started and the final are both lost on the way back
    r.start();
    const work = r.cloud.push({ text: "once" });
    await final(r, work);
    await r.cloud.until(async () => (await r.state.read()).outbox.length === 0, "outbox empty");
    assert.equal(r.cloud.finals(work.workId).length, 1);
    assert.equal(r.prompts().length, 1);
  });

  t("a claim whose answer is lost comes back as the same work and runs once", async r => {
    r.cloud.drops.poll = 1;
    r.start();
    const work = r.cloud.push({ text: "claimed twice" });
    await final(r, work);
    assert.equal(r.prompts().length, 1);
    assert.equal(r.cloud.polls[0].claimKey, r.cloud.polls[1].claimKey);
  });

  t("a cloud that is down keeps the result; when it is back the result arrives", async r => {
    r.start();
    const work = r.cloud.push({ text: "SLEEP:200 later" });
    await r.cloud.until(() => r.cloud.got(work.workId, "started")[0], "started");
    r.cloud.down = true;
    await r.cloud.until(() => r.prompts().length === 1 && r.cloud.finals(work.workId).length === 0, "helper ran");
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(r.cloud.finals(work.workId).length, 0);
    r.cloud.down = false;
    assert.equal((await final(r, work)).status, "done");
    assert.equal(r.prompts().length, 1);
  });

  t("a helper that dies mid-turn is needs_you and is not run again", async r => {
    r.start();
    const done = await final(r, r.cloud.push({ text: "CRASH now" }));
    assert.equal(done.status, "needs_you");
    assert.match(done.summary, /不会自动重做/);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(r.prompts().length, 1);
  });

  t("a runner that restarted mid-turn reports it unconfirmed and does not rerun it", async r => {
    const work = r.cloud.push({ text: "was running" });
    r.cloud.works[0].leased = true;
    await r.state.update(s => { s.current = { workId: work.workId, token: work.token, thread: "t_main", kind: "job", text: work.text }; });
    r.start();
    const done = await final(r, work);
    assert.equal(done.status, "needs_you");
    assert.match(done.ask.key, /^restart:/);
    assert.equal(r.prompts().length, 0);
  });

  t("stopping the runner mid-turn reports needs_you, not cancelled", async r => {
    r.start();
    const work = r.cloud.push({ text: "SLOW long" });
    await r.cloud.until(() => r.cloud.got(work.workId, "started")[0], "started");
    await r.stop();
    const done = r.cloud.finals(work.workId)[0];
    assert.equal(done.status, "needs_you");
    assert.match(done.ask.key, /^stopped:/);
  });

  t("the device credential and the folder never appear in a summary", async r => {
    r.start();
    const done = await final(r, r.cloud.push({ text: `leak ${r.cloud.deviceToken} CWD` }));
    assert.equal(done.status, "done", "the cloud refuses a receipt that holds the credential");
    assert.ok(!JSON.stringify(done).includes(r.cloud.deviceToken));
    assert.ok(!JSON.stringify(done).includes(r.workspace));
  });

  t("a message that is not valid is refused with a failed receipt and nothing is run", async r => {
    r.start();
    const work = r.cloud.push({ kind: "job", text: "   " });
    const done = await final(r, work);
    assert.equal(done.status, "failed");
    assert.equal(r.prompts().length, 0);
  });
}

test("pairing keeps the token, not the web key; a wrong key is refused", async () => {
  const cloud = await new FakeCloud().listen();
  try {
    const paired = await register({ url: cloud.url, resident: "default", webKey: "web-key", label: "x" });
    assert.deepEqual(paired, { runnerId: "run_1", token: cloud.deviceToken });
    await assert.rejects(register({ url: cloud.url, resident: "default", webKey: "wrong", label: "x" }), error => error instanceof CloudError && error.status === 403);
  } finally { await cloud.close(); }
});
