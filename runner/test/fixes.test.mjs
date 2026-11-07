// Review fixes: receipts that fit, revoke = stop, one writer for state.json, permission paths, open asks that can be closed.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { acquire, holder } from "../src/lock.mjs";
import { judge } from "../src/permission.mjs";
import { fit } from "../src/receipt.mjs";
import { FakeCloud } from "./fake-cloud.mjs";
import { final, rig } from "./rig.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(here, "..", "bin", "aelios-runner.mjs");
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test("fit: the worst receipts (long Chinese question, max_tokens with two 4000-character texts) stay under the limit", () => {
  const base = { receiptId: "w_1:final", workId: "w_1", token: "wt_x", type: "final", status: "needs_you" };
  const long = "字".repeat(4000);
  const worst = fit({ ...base, summary: long, ask: { key: "stop:abc", question: long }, resolve: Array.from({ length: 80 }, (_, i) => "q:" + i) });
  assert.ok(bytes(worst) <= 15_000, `got ${bytes(worst)}`);
  assert.ok(worst.summary.length > 500 && worst.ask.question.length > 500, "both texts keep a useful part");
  assert.equal(worst.resolve.length, 50);
  const small = { ...base, summary: "ok" };
  assert.deepEqual(fit(small), small, "a small receipt is left alone");
  assert.ok(!/[\ud800-\udbff]…?$/.test(fit({ ...base, summary: "😀".repeat(5000) }).summary.slice(0, -1) + "x"), "no half character");
});

for (const plugin of ["kiro", "dsh"]) {
  const t = (name, fn, extra) => test(`[${plugin}] ${name}`, async () => { const r = await rig(plugin, extra); try { await fn(r); } finally { await r.done(); } });

  t("a long answer is cut to fit, not lost", async r => {
    r.start();
    const done = await final(r, r.cloud.push({ text: "LONG:6000" }));
    assert.equal(done.status, "done");
    assert.ok(done.summary.length < 4001 && done.summary.length > 1000);
    assert.ok(bytes(done) <= 15_000);
  });

  t("a resident that answers 413 gets a shorter receipt, and the result is not dropped", async r => {
    r.cloud.receiptMax = 3000;
    r.start();
    const work = r.cloud.push({ text: "LONG:6000" });
    const done = await final(r, work);
    assert.equal(done.status, "done");
    assert.ok(bytes(done) <= 3000);
    await r.cloud.until(async () => (await r.state.read()).outbox.length === 0, "outbox empty");
  });

  t("revoking stops the running turn and the waiting work; the runner exits", async r => {
    r.start();
    const slow = r.cloud.push({ text: "SLOW first" });
    await r.cloud.until(() => r.cloud.got(slow.workId, "started")[0], "started");
    r.cloud.push({ kind: "mail", text: "second, waiting" });
    await r.cloud.until(async () => (await r.state.read()).queue.length === 1, "mail queued");
    r.cloud.revoked = true;
    await r.loop; // start() returns by itself
    const state = await r.state.read();
    assert.deepEqual([state.queue.length, state.device.revoked], [0, true]);
    assert.ok(r.log().some(e => e.event === "session/cancel"), "the running turn was cancelled");
    assert.equal(r.prompts().length, 1, "the waiting letter never ran");
  });

  t("a runner started on a revoked pairing runs nothing it still had queued", async r => {
    await r.state.update(s => { s.device.revoked = true; s.queue.push({ workId: "w_9", token: "wt_9", thread: "t_main", kind: "job", text: "old" }); });
    r.start();
    await r.loop;
    assert.equal(r.prompts().length, 0);
    assert.equal((await r.state.read()).queue.length, 0);
  });

  t("a resident that always answers 413: a few shorter tries, then the receipt is given up, not sent over and over", async r => {
    r.cloud.receiptMax = 1;
    r.start();
    const work = r.cloud.push({ text: "hello" });
    await r.cloud.until(async () => r.cloud.receiptHits > 0 && (await r.state.read()).outbox.length === 0, "receipts given up");
    await sleep(500);
    assert.ok(r.cloud.receiptHits <= 40, `receipt requests: ${r.cloud.receiptHits}`);
    assert.equal(r.cloud.finals(work.workId).length, 0);
  });

  t("a 403 from something in front of the resident is not a revoke: the receipt waits and arrives later", async r => {
    r.start();
    const work = r.cloud.push({ text: "SLEEP:200 later" });
    await r.cloud.until(() => r.cloud.got(work.workId, "started")[0], "started");
    r.cloud.forbidden = true;
    await sleep(600);
    const state = await r.state.read();
    assert.equal(state.device.revoked, undefined, "not treated as revoked");
    assert.equal(r.cloud.finals(work.workId).length, 0);
    r.cloud.forbidden = false;
    assert.equal((await final(r, work)).status, "done");
    await r.cloud.until(async () => (await r.state.read()).outbox.length === 0, "outbox empty");
  });

  t("an open ask from a restart or a runner error is closed by the next finished turn", async r => {
    const old = r.cloud.push({ text: "was running" });
    r.cloud.works[0].leased = true;
    await r.state.update(s => { s.current = { workId: old.workId, token: old.token, thread: "t_main", kind: "job", text: "was running" }; });
    r.start();
    const restart = await final(r, old);
    assert.equal(restart.ask.key, "restart:" + old.workId);
    const next = await final(r, r.cloud.push({ text: "carry on" }));
    assert.deepEqual(next.resolve, ["restart:" + old.workId]);
  });
}

test("permissions: a path outside the folder is refused on read and edit, whatever the kind; full is unrestricted", () => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "perm-")));
  const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), "perm-out-")));
  try {
    writeFileSync(path.join(outside, "secret"), "x");
    symlinkSync(outside, path.join(dir, "link"));
    const ask = (kind, ...files) => ({ kind, locations: files.map(file => ({ path: file })) });
    assert.equal(judge("read", ask("read", path.join(dir, "a")), dir).allow, true);
    assert.equal(judge("read", ask("read", path.join(outside, "secret")), dir).allow, false);
    assert.equal(judge("read", ask("search", path.join(dir, "a"), "/etc/passwd"), dir).allow, false, "one bad path is enough");
    assert.equal(judge("read", ask("read", path.join(dir, "link", "secret")), dir).allow, false, "a link out of the folder is outside");
    assert.equal(judge("read", ask("read", "relative/path"), dir).allow, false);
    assert.equal(judge("edit", ask("fetch", "/etc/hosts"), dir).allow, false);
    assert.equal(judge("edit", ask("fetch"), dir).allow, true, "edit lets the helper use the network");
    assert.equal(judge("read", ask("fetch"), dir).allow, false);
    assert.equal(judge("full", ask("read", "/etc/passwd"), dir).allow, true);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test("lock: one owner; a dead owner's lock is taken over", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lock-"));
  const file = path.join(dir, "runner.lock");
  try {
    const release = acquire(file);
    assert.equal(holder(file), process.pid);
    assert.throws(() => acquire(file), /already using/);
    release();
    assert.equal(existsSync(file), false);
    const gone = spawn(process.execPath, ["-e", ""]);
    await new Promise(resolve => gone.on("exit", resolve));
    writeFileSync(file, String(gone.pid));
    acquire(file)();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("command line: the helper must exist to pair; one start per folder; unpair stops a running start and nothing writes state over it", async () => {
  const cloud = await new FakeCloud().listen();
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "runner-lock-")));
  const agent = path.join(here, "fake-agent.mjs");
  const env = { ...process.env, AELIOS_RUNNER_HOME: path.join(home, "h"), AELIOS_WEB_KEY: "web-key", FAKE_STORE: path.join(home, "agent.json") };
  const run = (...args) => new Promise(resolve => execFile(process.execPath, [BIN, ...args], { env }, (error, out, err) => resolve({ code: error ? error.code : 0, out, err })));
  const pair = ["pair", "--url", cloud.url, "--workspace", path.join(home, "w"), "--access", "edit"];
  let child;
  try {
    mkdirSync(path.join(home, "h"), { recursive: true });
    const noBin = await new Promise(resolve => execFile(process.execPath, [BIN, ...pair, "--plugin", "kiro"], { env: { ...env, AELIOS_RUNNER_KIRO_BIN: "/nonexistent/kiro-cli" } }, (error, out, err) => resolve({ code: error?.code ?? 0, err })));
    assert.equal(noBin.code, 1);
    assert.match(noBin.err, /cannot find/);
    assert.equal(existsSync(path.join(home, "h", "state.json")), false, "nothing was paired");
    assert.equal((await run(...pair, "--plugin", "command", "--command", JSON.stringify([agent, "acp"]))).code, 0);

    child = spawn(process.execPath, [BIN, "start"], { env, stdio: "ignore" });
    const exited = new Promise(resolve => child.on("exit", resolve));
    await cloud.until(() => cloud.beats > 0 && holder(path.join(home, "h", "runner.lock")) === child.pid, "start running");
    const second = await run("start");
    assert.equal(second.code, 1);
    assert.match(second.err, /already using/);

    const unpaired = await run("unpair");
    assert.equal(unpaired.code, 0, unpaired.err);
    await Promise.race([exited, sleep(10_000).then(() => { throw new Error("start did not stop"); })]);
    await sleep(300);
    const state = JSON.parse(readFileSync(path.join(home, "h", "state.json"), "utf8"));
    assert.equal(state.device, null, "the running start did not write its old state back");
    assert.equal(existsSync(path.join(home, "h", "runner.lock")), false);
  } finally { child?.kill("SIGKILL"); await cloud.close(); rmSync(home, { recursive: true, force: true }); }
});
