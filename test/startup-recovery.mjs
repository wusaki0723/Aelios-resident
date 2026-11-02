// Execute complete, actual Resident recovery methods with real stores on Node SQLite.
// Only DO storage/scheduler/OAuth boundaries are synthetic; not a full Worker/SDK startup.
// Node 22+: node test/startup-recovery.mjs. No network, models, or deployment.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = readFileSync(new URL("../src/resident.ts", import.meta.url), "utf8");
function method(name) {
  const matches = [...source.matchAll(new RegExp(`^  (?:private |override )*(?:async )?${name}\\([^\\n]*[\\s\\S]*?^  \\}`, "gm"))];
  assert.equal(matches.length, 1, `extract exactly one complete actual Resident.${name}`);
  return matches[0][0].replace("override ", "");
}
const compiled = await build({
  stdin: {
    contents: `
      import { aeliosConfig } from "./src/aelios.ts";
      import { AlarmStore } from "./src/alarms.ts";
      import { LetterStateStore } from "./src/letter-state.ts";
      // The registered OAuth renderer is not invoked in these recovery tests.
      const callbackPage = () => { throw new Error("unexpected OAuth callback"); };
      export class RecoveryHarness {
        #letterState = null;
        #alarmStore = null;
        constructor(public sql, public cfg, public ctx, public mcp, public schedule, public cancelSchedule) {}
        // The menu-button repair onStart starts and does not wait for (src/resident.ts repairMenuButton): it talks
        // to Telegram, which these recovery tests have none of. A stub keeps what they do check unchanged.
        repairMenuButton() { return Promise.resolve(); }
        ${["onStart", "letterJob", "saveLetterJob", "letterState", "armLetterDelivery", "alarms", "armAlarm"].map(method).join("\n")}
      }
    `,
    loader: "ts", resolveDir: root, sourcefile: "startup-recovery-harness.ts",
  },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "error",
});
const { RecoveryHarness } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString("base64")}`);
const NOW = Date.UTC(2026, 0, 1);
const SECRET = "synthetic-private-key";
const PRIVATE = `https://private.example.test/identity ${SECRET} private-letter-text private-alarm-note`;
const cfg = { AELIOS_URL: "https://private.example.test", AELIOS_API_KEY: SECRET, AELIOS_NAMESPACE: "private-namespace" };

function fixture(t) {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("network forbidden"); });
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  const dir = mkdtempSync(join(tmpdir(), "resident-startup-"));
  const path = join(dir, "recovery.sqlite");
  let db;
  let resident;
  const kv = new Map([["letter_delivery_schedule", "old-delivery"]]);
  const calls = [];
  const cancelled = [];
  const failures = new Set();
  const f = { logs, kv, calls, cancelled, failures, queryFailure: null, get resident() { return resident; } };
  const sql = (strings, ...values) => {
    const query = strings.join("?");
    if (f.queryFailure && query.includes(f.queryFailure)) throw new Error(PRIVATE);
    const statement = db.prepare(query);
    if (statement.columns().length) return statement.all(...values);
    statement.run(...values);
    return [];
  };
  const schedule = async (when, callback, payload, options) => {
    const key = callback === "alarmRings" ? payload.id : callback;
    calls.push({ key, when, callback, payload, options });
    if (failures.has(key)) throw new Error(PRIVATE);
    return { id: `scheduled-${key}` };
  };
  const mcp = { configureOAuthCallback: t.mock.fn(), listServers: () => [] };
  const reopen = () => {
    db?.close();
    db = new DatabaseSync(path);
    resident = new RecoveryHarness(sql, cfg, {
      storage: {
        get: async (key) => kv.get(key),
        put: async (key, value) => { kv.set(key, value); },
        delete: async (key) => kv.delete(key),
      },
      // What onStart starts without waiting for; the stub resolves at once, and onStart logs any failure itself.
      waitUntil: () => {},
    }, mcp, schedule, async (id) => { cancelled.push(id); return true; });
  };
  t.after(() => { db?.close(); rmSync(dir, { recursive: true, force: true }); });
  reopen();
  resident.saveLetterJob({ promptId: "unfinished-prompt", reason: "handoff", fromMessageId: "from", toMessageId: "to", summary: "private-letter-text", createdAt: NOW - 1000 });
  resident.letterState().write({ state: "recovering", at: NOW - 1000 });
  const target = { url: cfg.AELIOS_URL, namespace: cfg.AELIOS_NAMESPACE };
  resident.letterState().enqueue({ id: "pending", at: NOW - 1000, text: "private-letter-text", target });
  resident.letterState().claim("pending", NOW - 1000);
  resident.letterState().attemptFailed("pending", "安全重试提示", NOW - 500);
  resident.letterState().enqueue({ id: "blocked", at: NOW - 1000, text: "private-letter-text", target });
  resident.letterState().block("blocked", "暂停投递");
  const alarms = [1, 2, 3].map((n) => {
    const alarm = resident.alarms().add(`private-alarm-note ${n}`, NOW + n * 60000, "", NOW - 1000);
    assert.ok(!("error" in alarm));
    resident.alarms().armed(alarm.id, alarm.next, `old-${alarm.id}`);
    return resident.alarms().get(alarm.id);
  });
  return Object.assign(f, { reopen, alarms, mcp, job: resident.letterJob(), pending: resident.letterState().get("pending"), write: resident.letterState().readWrite() });
}

function assertSafeLogs(f) {
  assert.ok(f.logs.length > 0, "failure is visible in logs, not silently ignored");
  const logged = JSON.stringify(f.logs);
  for (const privateValue of [SECRET, cfg.AELIOS_URL, cfg.AELIOS_NAMESPACE, "private-letter-text", "private-alarm-note"]) {
    assert.ok(!logged.includes(privateValue), `log must not contain ${privateValue}`);
  }
  assert.match(logged, /retained for retry/);
  assert.match(logged, /"error":"\w+"/, "the error's kind is logged for diagnosis");
}
function assertDurable(f) {
  assert.deepEqual(f.resident.letterJob(), f.job);
  assert.deepEqual(f.resident.letterState().get("pending"), f.pending, "no attempt consumed or delivery discarded");
  assert.deepEqual(f.resident.letterState().readWrite(), f.write);
  assert.equal(f.resident.alarms().all().length, 3, "failed alarms are never removed");
}

for (const failure of ["resumeLetter", "deliverLetters", "first-alarm", "middle-alarm", "all-schedules"]) {
  test(`onStart isolates ${failure}, retains durable work, and retries after SQLite reopen`, async (t) => {
    const f = fixture(t);
    const keys = ["resumeLetter", "deliverLetters", ...f.alarms.map((a) => a.id)];
    const failed = failure === "first-alarm" ? [f.alarms[0].id]
      : failure === "middle-alarm" ? [f.alarms[1].id]
      : failure === "all-schedules" ? keys : [failure];
    failed.forEach((key) => f.failures.add(key));
    await f.resident.onStart();
    assert.equal(f.mcp.configureOAuthCallback.mock.callCount(), 1);
    assert.deepEqual(f.calls.map((c) => c.key), keys, "all remaining recovery steps/alarms are attempted");
    assert.deepEqual(f.calls[0], { key: "resumeLetter", when: 1, callback: "resumeLetter", payload: {}, options: { idempotent: true } });
    assert.equal(f.resident.letterState().get("blocked").status, "pending");
    assertDurable(f);
    for (const alarm of f.alarms) {
      const stored = f.resident.alarms().get(alarm.id);
      assert.equal(stored.next, alarm.next);
      assert.equal(stored.note, alarm.note);
      assert.equal(stored.scheduleId, failed.includes(alarm.id) ? alarm.scheduleId : `scheduled-${alarm.id}`);
      if (failed.includes(alarm.id)) assert.ok(!f.cancelled.includes(alarm.scheduleId), "old alarm schedule is retained on failure");
    }
    if (failed.includes("deliverLetters")) {
      assert.equal(f.kv.get("letter_delivery_schedule"), "old-delivery");
      assert.ok(!f.cancelled.includes("old-delivery"));
    }
    assertSafeLogs(f);
    assert.equal(f.logs.length, failed.length, "each failed step/alarm is logged separately");

    f.failures.clear();
    f.calls.length = 0;
    f.logs.length = 0;
    f.reopen(); // New stores/Resident harness, real file-backed SQLite records.
    assertDurable(f);
    await f.resident.onStart();
    assert.deepEqual(f.calls.map((c) => c.key), keys);
    assert.deepEqual(f.logs, []);
    assertDurable(f);
    assert.equal(f.kv.get("letter_delivery_schedule"), "scheduled-deliverLetters");
    for (const alarm of f.alarms) assert.equal(f.resident.alarms().get(alarm.id).scheduleId, `scheduled-${alarm.id}`);
  });
}

for (const [name, query, skipped] of [
  ["letter job read", "SELECT * FROM res_letter_job", ["resumeLetter"]],
  ["blocked delivery restoration", "WHERE status = 'blocked' AND url", []],
  ["delivery queue read", "SELECT MIN(next_at)", ["deliverLetters"]],
  ["alarm enumeration", "SELECT * FROM res_alarms ORDER BY", ["alarms"]],
]) {
  test(`onStart isolates a ${name} storage failure too`, async (t) => {
    const f = fixture(t);
    f.queryFailure = query;
    await f.resident.onStart();
    const expected = ["resumeLetter", "deliverLetters", ...(skipped.includes("alarms") ? [] : f.alarms.map((a) => a.id))]
      .filter((key) => !skipped.includes(key));
    assert.deepEqual(f.calls.map((c) => c.key), expected);
    assertSafeLogs(f);
    assert.equal(f.logs.length, 1);
    f.queryFailure = null;
    assertDurable(f);
    if (name === "blocked delivery restoration") {
      assert.equal(f.resident.letterState().get("blocked").status, "blocked", "failed restoration is not marked successful");
      assert.equal(f.resident.letterState().summary().blocked, 1, "retry remains visible in status");
    }
    await f.resident.onStart();
    assert.equal(f.resident.letterState().get("blocked").status, "pending");
    assertDurable(f);
  });
}
