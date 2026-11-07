// The waiting list (src/waiting.ts, src/waiting-store.ts): kinds, order, one item per id, resolved asks leave, expiry,
// stopped threads give nothing, notes and pushes. Run: node test/waiting.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

mkdirSync("node_modules/.cache", { recursive: true });
const dir = mkdtempSync(join(realpathSync("node_modules/.cache"), "waiting-"));
let waiting, store, machine, cloud;
try {
  await build({ entryPoints: ["src/waiting.ts", "src/waiting-store.ts", "src/machine.ts", "src/cloud-tasks.ts"], bundle: true, platform: "node", format: "esm", outdir: dir, outExtension: { ".js": ".mjs" }, logLevel: "error" });
  const load = (name) => import(pathToFileURL(join(dir, `${name}.mjs`)).href);
  [waiting, store, machine, cloud] = await Promise.all([load("waiting"), load("waiting-store"), load("machine"), load("cloud-tasks")]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const DAY = 86_400_000;
const now = 100 * DAY;
const thread = (id, extra = {}) => ({ id, taskId: `${id}-t`, title: `Title ${id}`, status: "working", runs: "machine", summary: "", choices: [], waiting: false, updatedAt: now - 1000, ...extra });
const input = (extra = {}) => ({ asks: [], notes: [], threads: [], seen: new Set(), now, ...extra });
const ask = (extra = {}) => ({ thread: "a", task: "a-t", key: "k1", question: "Which one first? Then more.", options: ["A", "B"], recommend: "A", at: now - 1000, ...extra });

await test("kinds, the fixed format, one sentence, asks first then newest first", () => {
  const items = waiting.build(input({
    asks: [ask()],
    notes: [{ thread: "b", task: "b-t", key: "w1", text: "Found two config files. Using the first.", at: now - 500 }],
    threads: [thread("a", { status: "needs_you" }), thread("b"), thread("c", { status: "done", summary: "All done. Details follow." }), thread("d", { status: "failed", summary: "Blocked: no network" })]
  }));
  assert.deepEqual(items.map((i) => i.kind), ["ask", "note", "done", "stuck"]);
  const [a, ...rest] = items;
  assert.deepEqual(a, { id: "a:ask:k1", kind: "ask", thread: "a", task: "a-t", title: "Title a", line: "Which one first?", options: ["A", "B"], recommend: "A", at: now - 1000, expired: false });
  assert.deepEqual(rest.map((i) => [i.kind, i.line]), [["note", "Found two config files."], ["done", "All done."], ["stuck", "Blocked: no network"]]);
  assert.equal(waiting.firstSentence("x".repeat(300)).length, 120);
});

await test("a cloud task that waits is an ask; a stopped thread gives nothing; a machine thread's needs_you shows only its ask", () => {
  const items = waiting.build(input({ threads: [thread("c", { runs: "linux", status: "needs_you", waiting: true, summary: "Pick one.", choices: ["X"] }), thread("s", { status: "stopped" }), thread("m", { status: "needs_you", waiting: true })] }));
  assert.deepEqual(items.map((i) => [i.thread, i.kind, i.options]), [["c", "ask", ["X"]]]);
});

await test("the same ask twice is one item; read items go; a newer note replaces the older; expiry at 7 and drop at 14 days", () => {
  const twice = waiting.build(input({ asks: [ask({ at: now - 2000 }), ask({ at: now - 1000, question: "Newer?" })], threads: [thread("a")] }));
  assert.deepEqual(twice.map((i) => i.line), ["Newer?"]);
  const notes = [{ thread: "a", task: "a-t", key: "w1", text: "old", at: now - 3000 }, { thread: "a", task: "a-t", key: "w2", text: "new", at: now - 1000 }];
  assert.deepEqual(waiting.build(input({ notes, threads: [thread("a")] })).map((i) => i.line), ["new"]);
  assert.deepEqual(waiting.build(input({ notes, threads: [thread("a")], seen: new Set(["a:note:w2"]) })), []);
  const old = waiting.build(input({ asks: [ask({ at: now - 8 * DAY })], threads: [thread("a")] }));
  assert.deepEqual([old[0].expired, old[0].options, old[0].recommend], [true, [], ""]);
  assert.deepEqual(waiting.build(input({ asks: [ask({ at: now - 15 * DAY })], threads: [thread("a")] })), []);
});

function fixture() {
  const db = new DatabaseSync(":memory:");
  const sql = (strings, ...values) => {
    const statement = db.prepare(strings.join("?"));
    return /^\s*SELECT/i.test(strings[0]) ? statement.all(...values) : (statement.run(...values), []);
  };
  const atomic = (fn) => { db.exec("BEGIN IMMEDIATE"); try { const out = fn(); db.exec("COMMIT"); return out; } catch (error) { db.exec("ROLLBACK"); throw error; } };
  const tasks = new cloud.TaskStore(sql);
  const machines = new machine.MachineStore(sql, tasks, atomic);
  return { tasks, machines, list: new store.WaitingStore(sql, tasks, machines) };
}

await test("the store: an ask from a receipt is listed and pushed once; resolving it removes it; a done is read once", async () => {
  const f = fixture();
  const { code } = await f.machines.code();
  const { token } = await f.machines.register({ label: "VPS", code }, false);
  await f.machines.heartbeat(token);
  const { task } = f.tasks.add({ title: "Job", job: "do it", execution: "machine" });
  f.machines.enqueue(task, "job", "do it");
  const { work } = await f.machines.poll(token, { claimKey: "ck_aaaaaaaa" });
  const receipt = (extra) => ({ receiptId: `${work.workId}:final`, workId: work.workId, token: work.token, type: "final", ...extra });
  await f.machines.receipt(token, receipt({ status: "needs_you", summary: "Waiting.", ask: { key: "q1", question: "Which?", options: ["A"] } }));
  let { items, open } = f.list.list();
  assert.deepEqual([items.map((i) => i.kind), open], [["ask"], 1]);
  assert.equal(f.list.unpushed().length, 1);
  assert.equal(f.list.unpushed().length, 0, "once per item");
  // A later job in the thread finishes and resolves the ask: the ask goes, the done shows.
  const { task: next } = f.tasks.add({ title: "Job", job: "go on", execution: "machine", follows: task.id, direct: true });
  f.machines.enqueue(next, "say", "go on");
  const { work: second } = await f.machines.poll(token, { claimKey: "ck_bbbbbbbb" });
  await f.machines.receipt(token, { receiptId: `${second.workId}:final`, workId: second.workId, token: second.token, type: "final", status: "done", summary: "Done. Fine.", resolve: ["q1"] });
  ({ items, open } = f.list.list());
  assert.deepEqual([items.map((i) => i.kind), open], [["done"], 0]);
  assert.equal(f.list.unpushed().length, 0, "a done is not pushed");
  f.list.read(items[0].id);
  assert.deepEqual(f.list.list().items, []);
});
