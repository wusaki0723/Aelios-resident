// Unit tests for the alarms the resident sets itself and the heartbeat's prompt (src/alarms.ts, src/prompts.ts).
// Usage: node test/alarms.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

mkdirSync("node_modules/.cache", { recursive: true });
const dir = mkdtempSync(join("node_modules/.cache", "resident-alarms-"));
const out = join(dir, "alarms.mjs");
await build({
  stdin: { contents: 'export * from "./src/alarms.ts"; export * from "./src/prompts.ts";', resolveDir: process.cwd(), loader: "ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  logLevel: "error"
});
const { AlarmStore, RINGS_PER_DAY, parseRule, nextRing, parseAt, planAlarm, ruleInWords, alarmNote, heartbeatPrompt, isCheckin, isNote, SELF_MIN_MINUTES } = await import(
  pathToFileURL(join(process.cwd(), out)).href
);
rmSync(dir, { recursive: true, force: true });

const SH = "Asia/Shanghai";
const MIN = 60_000;
const HOUR = 60 * MIN;
const utc = (text) => Date.parse(`${text}Z`);
// 2026-10-24 is a Saturday; 21:00 in Shanghai.
const SAT_9PM = utc("2026-10-24T13:00:00");

let failed = 0;
function step(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

step("repeats are read in CHECKIN_SCHEDULE's words, at most once an hour", () => {
  assert.deepEqual(parseRule("every day at 21:30"), { kind: "days", days: "daily", hour: 21, minute: 30 });
  assert.deepEqual(parseRule("  Every weekday at 8:05 "), { kind: "days", days: "weekday", hour: 8, minute: 5 });
  assert.deepEqual(parseRule("every week on sun, sat,saturday at 10:00"), { kind: "days", days: [0, 6], hour: 10, minute: 0 });
  assert.deepEqual(parseRule("every 3 hours"), { kind: "hours", hours: 3 });
  assert.deepEqual(parseRule("every 1 hour"), { kind: "hours", hours: 1 });
  for (const bad of ["every 30 minutes", "every 0 hours", "every 200 hours", "every week on funday at 10:00", "every day at 25:00", "tomorrow", ""]) {
    assert.ok("error" in parseRule(bad), bad);
  }
});

step("the next ring of a repeat is on their wall clock", () => {
  const daily = parseRule("every day at 21:30");
  assert.equal(nextRing(daily, 0, SAT_9PM, SH), utc("2026-10-24T13:30:00"));
  assert.equal(nextRing(daily, 0, utc("2026-10-24T13:30:00"), SH), utc("2026-10-25T13:30:00"), "exactly at the time: the next day");
  assert.equal(nextRing(parseRule("every weekday at 08:00"), 0, SAT_9PM, SH), utc("2026-10-26T00:00:00"), "Saturday night: Monday");
  assert.equal(nextRing(parseRule("every week on sat,sun at 10:00"), 0, SAT_9PM, SH), utc("2026-10-25T02:00:00"));
  const anchor = utc("2026-10-24T01:00:00");
  assert.equal(nextRing(parseRule("every 3 hours"), anchor, anchor + 5 * HOUR, SH), anchor + 6 * HOUR);
  assert.equal(nextRing(parseRule("every 3 hours"), anchor, anchor, SH), anchor + 3 * HOUR);
});

step("a time once: a date and time, or just a time (the next one), in their time zone", () => {
  assert.equal(parseAt("2026-10-24 21:30", SAT_9PM, SH), utc("2026-10-24T13:30:00"));
  assert.equal(parseAt("2026-10-24T21:30", SAT_9PM, SH), utc("2026-10-24T13:30:00"));
  assert.equal(parseAt("21:30", SAT_9PM, SH), utc("2026-10-24T13:30:00"));
  assert.equal(parseAt("08:00", SAT_9PM, SH), utc("2026-10-25T00:00:00"));
  // New York leaves daylight saving time on 2026-11-01.
  assert.equal(parseAt("2026-10-30 09:00", SAT_9PM, "America/New_York"), utc("2026-10-30T13:00:00"));
  assert.equal(parseAt("2026-11-02 09:00", SAT_9PM, "America/New_York"), utc("2026-11-02T14:00:00"));
  assert.ok("error" in parseAt("tomorrow evening", SAT_9PM, SH));
  assert.match(parseAt("2027-02-30 09:00", SAT_9PM, SH).error, /no 2027-02-30/, "a date that does not exist");
  // 02:30 does not happen in New York on 2027-03-14: the clocks go from 02:00 to 03:00, so it rings at 03:00 + 30.
  assert.equal(parseAt("2027-03-14 02:30", SAT_9PM, "America/New_York"), utc("2027-03-14T07:30:00"));
  assert.equal(nextRing(parseRule("every day at 02:30"), 0, utc("2027-03-13T12:00:00"), "America/New_York"), utc("2027-03-14T07:30:00"));
  // 01:30 happens twice on 2026-11-01: the first one.
  assert.equal(parseAt("2026-11-01 01:30", SAT_9PM, "America/New_York"), utc("2026-11-01T05:30:00"));
});

step("a new alarm: exactly one of the three, not in the past, far enough ahead outside their own messages", () => {
  assert.match(planAlarm({ note: "x" }, SAT_9PM, SH, true).error, /exactly one/);
  assert.match(planAlarm({ note: "x", in_minutes: 5, at: "22:00" }, SAT_9PM, SH, true).error, /exactly one/);
  assert.deepEqual(planAlarm({ note: "x", in_minutes: 1 }, SAT_9PM, SH, true), { next: SAT_9PM + MIN, repeat: "" });
  assert.match(planAlarm({ note: "x", in_minutes: 0 }, SAT_9PM, SH, true).error, /minutes/);
  assert.match(planAlarm({ note: "x", in_minutes: 30 }, SAT_9PM, SH, false).error, new RegExp(`at least ${SELF_MIN_MINUTES} minutes`));
  assert.deepEqual(planAlarm({ note: "x", in_minutes: 61 }, SAT_9PM, SH, false), { next: SAT_9PM + 61 * MIN, repeat: "" });
  assert.match(planAlarm({ note: "x", at: "2026-10-24 20:00" }, SAT_9PM, SH, true).error, /passed/);
  assert.match(planAlarm({ note: "x", at: "2027-12-01 20:00" }, SAT_9PM, SH, true).error, /year/);
  assert.match(planAlarm({ note: "x", repeat: "every 10 minutes" }, SAT_9PM, SH, true).error, /once an hour/);
  // 21:30 is half an hour away: from a ring or a heartbeat it starts the next day.
  assert.deepEqual(planAlarm({ note: "x", repeat: "Every Day at 21:30" }, SAT_9PM, SH, true), { next: utc("2026-10-24T13:30:00"), repeat: "every day at 21:30" });
  assert.deepEqual(planAlarm({ note: "x", repeat: "every day at 21:30" }, SAT_9PM, SH, false), { next: utc("2026-10-25T13:30:00"), repeat: "every day at 21:30" });
  assert.deepEqual(planAlarm({ note: "x", repeat: "every 2 hours" }, SAT_9PM, SH, false), { next: SAT_9PM + 2 * HOUR, repeat: "every 2 hours" });
  // A shorter minute, as in the local tests.
  assert.deepEqual(planAlarm({ note: "x", in_minutes: 61 }, SAT_9PM, SH, false, 50), { next: SAT_9PM + 61 * 50, repeat: "" });
});

step("repeats in words for the settings page", () => {
  assert.equal(ruleInWords(""), "一次");
  assert.equal(ruleInWords("every day at 9:00"), "每天 09:00");
  assert.equal(ruleInWords("every weekday at 08:30"), "工作日 08:30");
  assert.equal(ruleInWords("every week on sat,sun at 10:00"), "每周六、日 10:00");
  assert.equal(ruleInWords("every 3 hours"), "每 3 小时");
});

step("a ring's note and the heartbeat are notes, not from them, and may pass with SKIP", () => {
  const once = alarmNote({ id: "a_12345678", note: "问她面试怎么样", repeat: "", anchor: 0, next: 0, scheduleId: "", setAt: 0 }, "10-24 周六 21:30", "10-24 周六 09:00");
  assert.ok(isNote(once) && isCheckin(once));
  assert.match(once, /<<<\n问她面试怎么样\n>>>/);
  assert.match(once, /once and is gone/);
  assert.match(once, /SKIP/);
  const again = alarmNote({ id: "a_12345678", note: "早安", repeat: "every day at 08:00", anchor: 0, next: 0, scheduleId: "", setAt: 0 }, "x", "y");
  assert.match(again, /repeats \(every day at 08:00\) until you cancel it \(id a_12345678\)/);
  const beat = heartbeatPrompt("10-24 周六 21:30", 55, 1, 3, false);
  assert.ok(isNote(beat) && isCheckin(beat));
  assert.match(beat, /they have not written for 55 minutes, and it is now 10-24 周六 21:30\. This is heartbeat 1 of 3 while they are quiet\.\)/);
  assert.doesNotMatch(beat, /set_alarm/);
  assert.match(heartbeatPrompt("x", 165, 3, 3, false), /heartbeat 3 of 3 while they are quiet, the last\.\)/);
  assert.doesNotMatch(heartbeatPrompt("x", 55, 1, 1, false), /of 1/, "no count when there is only one");
  assert.match(heartbeatPrompt("x", 1, 1, 1, true), /1 minute,.*set_alarm/s);
  assert.ok(!isCheckin("[10-24 周六 21:30] 你好"));
});

step("a ring is counted once under its stable key and a failed admission can release it", () => {
  const db = new DatabaseSync(":memory:");
  const sql = (strings, ...values) => {
    const statement = db.prepare(strings.join("?"));
    return /^\s*SELECT/i.test(strings[0]) ? statement.all(...values) : (statement.run(...values), []);
  };
  const store = new AlarmStore(sql);
  const now = Date.now();
  assert.equal(store.ring(now, "alarm_a_1"), true);
  assert.equal(store.ring(now, "alarm_a_1"), true, "replaying one ring does not consume another slot");
  for (let n = 2; n <= RINGS_PER_DAY; n += 1) assert.equal(store.ring(now, `alarm_a_${n}`), true);
  assert.equal(store.ring(now, "alarm_over"), false);
  store.releaseRing("alarm_a_1");
  assert.equal(store.ring(now, "alarm_over"), true);
});

if (failed) process.exitCode = 1;
