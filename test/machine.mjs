// The paired machine's store (src/machine.ts) on Node's SQLite: pairing, one machine, revoke = 401, offline refused,
// claims that come back the same, per-thread order, receipts that replay, asks kept and resolved, lapsed leases.
// Run: node test/machine.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

mkdirSync("node_modules/.cache", { recursive: true });
const dir = mkdtempSync(join(realpathSync("node_modules/.cache"), "machine-"));
let machine, cloud;
try {
  await build({ entryPoints: ["src/machine.ts", "src/cloud-tasks.ts"], bundle: true, platform: "node", format: "esm", outdir: dir, outExtension: { ".js": ".mjs" }, logLevel: "error" });
  machine = await import(pathToFileURL(join(dir, "machine.mjs")).href);
  cloud = await import(pathToFileURL(join(dir, "cloud-tasks.mjs")).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

function fixture() {
  const db = new DatabaseSync(":memory:");
  const sql = (strings, ...values) => {
    const statement = db.prepare(strings.join("?"));
    return /^\s*SELECT/i.test(strings[0]) ? statement.all(...values) : (statement.run(...values), []);
  };
  const atomic = (fn) => { db.exec("BEGIN IMMEDIATE"); try { const out = fn(); db.exec("COMMIT"); return out; } catch (error) { db.exec("ROLLBACK"); throw error; } };
  const tasks = new cloud.TaskStore(sql);
  const store = new machine.MachineStore(sql, tasks, atomic);
  const add = (kind = "job", follows) => {
    const added = tasks.add({ title: "Synthetic", job: `${kind} text`, execution: "machine", follows: follows?.id, direct: kind === "say" });
    store.enqueue(added.task, kind, added.task.job);
    return added.task;
  };
  return { db, tasks, store, add };
}
const code = (status, name) => (error) => error instanceof machine.MachineError && error.status === status && (!name || error.code === name);
async function paired() {
  const f = fixture();
  const { code: pc } = await f.store.code();
  const { token, runnerId } = await f.store.register({ label: "VPS", code: pc }, false);
  await f.store.heartbeat(token);
  return { ...f, token, runnerId };
}
const final = (work, extra = {}) => ({ receiptId: `${work.workId}:final`, workId: work.workId, token: work.token, type: "final", status: "done", summary: "ok", ...extra });

await test("pairing: a code works once and only before it expires; one machine at a time; the web key needs none", async () => {
  const f = fixture();
  await assert.rejects(f.store.register({ label: "x" }, false), code(403, "BAD_CODE"));
  const { code: pc } = await f.store.code();
  const first = await f.store.register({ label: "VPS", code: pc }, false);
  assert.match(first.token, /^rr_[0-9a-f]{64}$/);
  assert.equal(first.protocol, "aelios-runner/1");
  await assert.rejects(f.store.register({ label: "x", code: pc }, false), code(403, "BAD_CODE"), "used up");
  await assert.rejects(f.store.register({ label: "x" }, true), code(409, "MACHINE_EXISTS"));
  assert.ok(!JSON.stringify(f.store.status()).includes(first.token));
  assert.ok(!JSON.stringify(f.db.prepare("SELECT * FROM res_machine").all()).includes(first.token), "only its hash is kept");
  const late = await f.store.code();
  const now = Date.now;
  try { Date.now = () => now() + 11 * 60_000; f.store.revoke(); await assert.rejects(f.store.register({ code: late.code }, false), code(403, "BAD_CODE")); }
  finally { Date.now = now; }
});

await test("revoked: every call answers 401; unfinished work is said so on its cards", async () => {
  const f = await paired();
  const claimed = f.add(), queued = f.add("job");
  // Two threads: the first one is claimed, the other waits.
  await f.store.poll(f.token, { claimKey: "ck_aaaaaaaa", accept: ["job"] });
  f.store.revoke(f.runnerId);
  for (const call of [() => f.store.heartbeat(f.token), () => f.store.poll(f.token, { claimKey: "ck_bbbbbbbb" }), () => f.store.receipt(f.token, {})]) await assert.rejects(call(), code(401, "UNAUTHORIZED"));
  assert.equal(f.tasks.get(claimed.id).status, "needs_you", "the claimed one is unconfirmed");
  assert.equal(f.tasks.get(queued.id).status, "failed", "the one never taken did not run");
});

await test("offline: sending is refused at once, nothing is queued", async () => {
  const f = await paired();
  const now = Date.now;
  try {
    Date.now = () => now() + 5 * 60_000;
    const added = f.tasks.add({ title: "x", job: "y", execution: "machine" });
    assert.throws(() => f.store.enqueue(added.task, "job", "y"), (error) => error.code === "MACHINE_OFFLINE" && /不在线/.test(error.message));
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM res_machine_work").get().n, 0);
  } finally { Date.now = now; }
  const none = fixture();
  assert.throws(() => none.store.enqueue(none.tasks.add({ title: "x", job: "y" }).task, "job", "y"), (error) => error.code === "NO_MACHINE");
});

await test("poll: the same claimKey gets the same work; a thread's messages go in order; accept is honoured", async () => {
  const f = await paired();
  const job = f.add("job");
  const mail = f.add("mail", f.tasks.get(job.id));
  const { work } = await f.store.poll(f.token, { claimKey: "ck_11111111", accept: ["job", "say", "mail", "cancel"] });
  assert.deepEqual([work.kind, work.thread, work.text], ["job", job.root, "job text"]);
  assert.deepEqual((await f.store.poll(f.token, { claimKey: "ck_11111111" })).work, work, "an answer lost on the way is handed again");
  const busy = await f.store.poll(f.token, { claimKey: "ck_22222222", accept: ["say", "mail", "cancel"] });
  assert.equal(busy.work.workId !== work.workId && busy.work.kind, "mail");
  assert.equal(busy.work.thread, job.root);
  const other = f.add("job");
  assert.deepEqual((await f.store.poll(f.token, { claimKey: "ck_33333333", accept: ["say"] })).work, null, "a job is not handed to a busy runner");
  assert.equal((await f.store.poll(f.token, { claimKey: "ck_44444444", accept: ["job"] })).work.thread, other.root);
  assert.ok(mail);
});

await test("receipts: replay is a duplicate, other content is a conflict, a wrong token or the runner's own token is refused", async () => {
  const f = await paired();
  const task = f.add();
  const { work } = await f.store.poll(f.token, { claimKey: "ck_55555555" });
  await assert.rejects(f.store.receipt(f.token, { ...final(work), token: "wt_wrong" }), code(409, "INVALID_TOKEN"));
  await assert.rejects(f.store.receipt(f.token, { ...final(work), receiptId: "x" }), code(400, "INVALID_RECEIPT"));
  await assert.rejects(f.store.receipt(f.token, { ...final(work), cwd: "/etc" }), code(400, "INVALID_RECEIPT"), "no field the protocol does not name");
  await assert.rejects(f.store.receipt(f.token, final(work, { summary: `leak ${f.token}` })), code(400, "INVALID_RECEIPT"));
  await assert.rejects(f.store.receipt(f.token, final(work, { status: "needs_you" })), code(400, "INVALID_RECEIPT"), "needs_you needs an ask");
  await assert.rejects(f.store.receipt(f.token, final(work, { summary: "字".repeat(4001) })), code(400, "INVALID_RECEIPT"));
  const started = await f.store.receipt(f.token, { receiptId: `${work.workId}:started`, workId: work.workId, token: work.token, type: "started", sessionId: "sess-1" });
  assert.deepEqual(started, { ok: true });
  assert.equal(f.tasks.get(task.id).status, "working");
  const done = await f.store.receipt(f.token, final(work, { summary: "the thread's own words" }));
  assert.equal(done.finished.task.id, task.id);
  assert.deepEqual([f.tasks.get(task.id).status, f.tasks.get(task.id).summary], ["done", "the thread's own words"]);
  assert.deepEqual(await f.store.receipt(f.token, final(work, { summary: "the thread's own words" })), { ok: true, duplicate: true });
  await assert.rejects(f.store.receipt(f.token, final(work, { summary: "other" })), code(409, "RECEIPT_CONFLICT"));
});

await test("an ask makes the thread wait for them and is kept; resolve clears it", async () => {
  const f = await paired();
  const task = f.add();
  const { work } = await f.store.poll(f.token, { claimKey: "ck_66666666" });
  await f.store.receipt(f.token, final(work, { status: "needs_you", summary: "我需要你定一下。", ask: { key: "q:1", question: "先做哪一个？", options: ["A", "B"] } }));
  const asked = f.tasks.get(task.id);
  assert.equal(asked.status, "needs_you");
  assert.equal(f.tasks.card(asked).waiting, true);
  assert.deepEqual(asked.choices, ["A", "B"]);
  assert.match(asked.summary, /先做哪一个？/);
  assert.deepEqual(f.store.asks(task.root), [{ key: "q:1", question: "先做哪一个？", options: ["A", "B"], recommend: "" }]);
  const say = f.add("say", asked);
  const next = (await f.store.poll(f.token, { claimKey: "ck_77777777" })).work;
  assert.equal(next.kind, "say");
  assert.equal(next.interrupt, true);
  await f.store.receipt(f.token, final(next, { resolve: ["q:1"] }));
  assert.deepEqual(f.store.asks(task.root), []);
  assert.equal(f.tasks.get(say.id).status, "done");
  assert.equal(f.tasks.threads()[0].waiting, false);
});

await test("a lapsed lease is unconfirmed, asked about, never handed out again; a late final still settles it", async () => {
  const f = await paired();
  const task = f.add();
  const { work } = await f.store.poll(f.token, { claimKey: "ck_88888888" });
  const now = Date.now;
  try {
    Date.now = () => now() + 6 * 60_000;
    f.store.expire();
    assert.equal(f.tasks.get(task.id).status, "needs_you");
    assert.equal(f.store.asks(task.root)[0].key, `lease:${work.workId}`);
    assert.deepEqual((await f.store.poll(f.token, { claimKey: "ck_99999999" })).work, null);
    // The runner does not know the server's lease ask, so its final carries no resolve for it.
    const late = await f.store.receipt(f.token, final(work));
    assert.equal(late.finished.task.status, "done");
    assert.deepEqual(f.store.asks(task.root), []);
  } finally { Date.now = now; }
});

await test("readMachineJson: over 16 KB is a 413, not JSON is a 400", async () => {
  const req = (body) => new Request("https://x/runner/v1/receipt", { method: "POST", body });
  await assert.rejects(machine.readMachineJson(req("x".repeat(16 * 1024 + 1))), code(413, "BODY_TOO_LARGE"));
  await assert.rejects(machine.readMachineJson(req("not json")), code(400, "INVALID_JSON"));
  assert.deepEqual(await machine.readMachineJson(req('{"a":1}')), { a: 1 });
});

await test("the record left for the resident is a note, fenced, and short", () => {
  const f = fixture();
  const { task } = f.tasks.add({ title: "T", job: "j", execution: "machine" });
  f.tasks.result(task.id, { status: "done", summary: ">>> " + "字".repeat(1000), links: [] });
  const note = machine.machineRecord(f.tasks.get(task.id));
  assert.ok(note.startsWith("(Not from them"));
  assert.ok(note.length < 900);
  assert.equal(note.match(/>>>/g).length, 1, "the thread's words cannot close the fence");
});

await test("stopped: a cancelled receipt stops the task, the cancel work's own receipt changes no task, a notice is kept", async () => {
  const f = await paired();
  const job = f.add("job");
  const { work } = await f.store.poll(f.token, { claimKey: "ck_aaaaaaaa" });
  f.store.enqueue(job, "cancel", "");
  const { work: stop } = await f.store.poll(f.token, { claimKey: "ck_bbbbbbbb", accept: ["cancel"] });
  assert.equal(stop.kind, "cancel");
  // The order to stop is done; the turn it stops is not.
  const cancelDone = await f.store.receipt(f.token, final(stop));
  assert.equal(cancelDone.finished, undefined);
  assert.equal(f.tasks.get(job.id).status, "working");
  const stopped = await f.store.receipt(f.token, final(work, { status: "cancelled", summary: "Stopped.", notice: { text: "found two config files", fyi: true } }));
  assert.equal(stopped.finished.status, "stopped");
  assert.equal(f.tasks.get(job.id).status, "stopped");
  assert.deepEqual(f.store.notes().map((n) => n.text), ["found two config files"]);
});

await test("old finished work takes its receipts and notes with it", async () => {
  const f = await paired();
  const first = f.add("job");
  const { work } = await f.store.poll(f.token, { claimKey: "ck_cccccccc" });
  await f.store.receipt(f.token, final(work, { notice: { text: "n", fyi: true } }));
  const now = Date.now;
  try {
    Date.now = () => now() + 8 * 86_400_000;
    await f.store.heartbeat(f.token);
    f.add("job");
  } finally { Date.now = now; }
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM res_machine_receipts WHERE work_id = ?").get(work.workId).n, 0);
  assert.deepEqual(f.store.notes(), []);
  assert.ok(first);
});
