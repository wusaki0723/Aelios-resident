// Alarms the resident sets for itself (ALARMS=on): a note to itself that comes back at a time it chose, once or
// on repeat. Each ring is one turn of the resident's, like a check-in: it messages them or lets it pass (SKIP).
// A ring after an hour of quiet finds the prompt cache gone and pays for the whole conversation again, so the
// number of alarms, how often one repeats and how often they ring in a day are all capped.

import { ALARM_PREFIX } from "./prompts";
import type { Sql } from "./sticker-store";

export const MAX_ALARMS = 10;
/** Rings in any 24 hours, all alarms together; the ones over it pass without a turn. */
export const RINGS_PER_DAY = 24;
/** In a turn that is not theirs (a check-in, a ring, a heartbeat), an alarm is set at least this far ahead. */
export const SELF_MIN_MINUTES = 60;
const NOTE_MAX = 500;
const AHEAD_MAX_DAYS = 366;

export const SET_ALARM_DESCRIPTION =
  "Set an alarm for yourself. When it goes off you get back the note you write here and can message them, or let " +
  "it pass. Use it to come back later: a reminder they asked for, asking how something went, or trying again when " +
  "now is not a good time. Give exactly one of in_minutes, at or repeat. Each ring is a turn of yours and costs " +
  `about a message, more after an hour of quiet, so set only the alarms you mean. At most ${MAX_ALARMS} at a time.`;

export const LIST_ALARMS_DESCRIPTION = "The alarms you have set, with their ids and when each rings next.";
export const CANCEL_ALARM_DESCRIPTION = "Cancel an alarm you set, by its id (a_…).";

/** How an alarm repeats; "" for one that rings once. */
export type Rule =
  | { kind: "days"; days: "daily" | "weekday" | number[]; hour: number; minute: number }
  | { kind: "hours"; hours: number };

export type Alarm = {
  id: string;
  note: string;
  /** The repeat as written ("every day at 21:30"), "" for a one-time alarm. */
  repeat: string;
  /** When an "every N hours" alarm was set: its rings fall on that time plus whole multiples of N hours. */
  anchor: number;
  next: number;
  scheduleId: string;
  setAt: number;
};

type Row = { id: string; note: string; repeat: string; anchor: number; next_at: number; schedule_id: string; set_at: number };

const DAYS: Record<string, number> = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const DAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

function clock(text: string): { hour: number; minute: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

/** A repeat in the same words as CHECKIN_SCHEDULE, at most once an hour, or why it is not one. */
export function parseRule(raw: string): Rule | { error: string } {
  const text = raw.trim().replace(/\s+/g, " ").toLowerCase();
  const hours = /^every (\d+) hours?$/.exec(text);
  if (hours) {
    const n = Number(hours[1]);
    return n >= 1 && n <= 24 * 7 ? { kind: "hours", hours: n } : { error: "every N hours takes N from 1 to 168." };
  }
  if (/^every \d+ minutes?$/.test(text)) return { error: "An alarm repeats at most once an hour." };
  const daily = /^every (day|weekday) at (\S+)$/.exec(text);
  const weekly = /^every week on ([a-z, ]+) at (\S+)$/.exec(text);
  const at = clock((daily ?? weekly)?.[2] ?? "");
  if (daily && at) return { kind: "days", days: daily[1] === "day" ? "daily" : "weekday", ...at };
  if (weekly && at) {
    const days = [...new Set(weekly[1].split(",").map((day) => DAYS[day.trim()]))];
    if (days.some((day) => day === undefined) || !days.length) return { error: "Days are mon, tue, wed, thu, fri, sat, sun." };
    return { kind: "days", days: days.sort(), ...at };
  }
  return { error: 'repeat is "every day at 21:30", "every weekday at 08:00", "every week on sat,sun at 10:00" or "every 3 hours".' };
}

type Local = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function localOf(at: number, timeZone: string): Local {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
    formatters.set(timeZone, format);
  }
  const parts = format.formatToParts(new Date(at));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
    hour: Number(part("hour")),
    minute: Number(part("minute")),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"))
  };
}

/**
 * The instant a wall-clock time in the time zone falls on. Around a change of daylight saving time the offset is
 * tried at both guesses; a time the clocks skip (spring forward) becomes the moment just after the gap.
 */
export function instantOf(local: Omit<Local, "weekday">, timeZone: string): number {
  const naive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const offset = (at: number) => {
    const seen = localOf(at, timeZone);
    return Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute) - Math.floor(at / 60000) * 60000;
  };
  const first = naive - offset(naive);
  const second = naive - offset(first);
  const shows = (at: number) => {
    const seen = localOf(at, timeZone);
    return seen.year === local.year && seen.month === local.month && seen.day === local.day && seen.hour === local.hour && seen.minute === local.minute;
  };
  return [second, first].find(shows) ?? Math.max(first, second);
}

/** When a repeating alarm rings next, after `after`. */
export function nextRing(rule: Rule, anchor: number, after: number, timeZone: string): number {
  if (rule.kind === "hours") {
    const step = rule.hours * 3600_000;
    return anchor + (Math.floor(Math.max(0, after - anchor) / step) + 1) * step;
  }
  const today = localOf(after, timeZone);
  for (let offset = 0; offset < 9; offset += 1) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const at = instantOf({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: rule.hour, minute: rule.minute }, timeZone);
    const weekday = date.getUTCDay();
    const allowed = rule.days === "daily" || (rule.days === "weekday" ? weekday >= 1 && weekday <= 5 : rule.days.includes(weekday));
    if (allowed && at > after) return at;
  }
  throw new Error("no next ring");
}

/** "2026-10-24 21:30" or "21:30" (the next time the clock says so) in their time zone. */
export function parseAt(raw: string, now: number, timeZone: string): number | { error: string } {
  const text = raw.trim().replace("T", " ");
  const time = clock(text);
  if (time) return nextRing({ kind: "days", days: "daily", ...time }, 0, now, timeZone);
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}:\d{2})$/.exec(text);
  const at = match ? clock(match[4]) : null;
  if (!match || !at) return { error: 'at is their local time, "2026-10-24 21:30", or just "21:30".' };
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { error: `There is no ${match[1]}-${match[2]}-${match[3]}.` };
  return instantOf({ year, month, day, ...at }, timeZone);
}

/** A repeat in their words, for the settings page. */
export function ruleInWords(repeat: string): string {
  if (!repeat) return "一次";
  const rule = parseRule(repeat);
  if ("error" in rule) return repeat;
  if (rule.kind === "hours") return `每 ${rule.hours} 小时`;
  const time = `${String(rule.hour).padStart(2, "0")}:${String(rule.minute).padStart(2, "0")}`;
  if (rule.days === "daily") return `每天 ${time}`;
  if (rule.days === "weekday") return `工作日 ${time}`;
  // Monday first, Sunday last, as a week is read in Chinese.
  const days = [...rule.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  return `每周${days.map((day) => DAY_NAMES[day]).join("、")} ${time}`;
}

export type AlarmInput = { note: string; in_minutes?: number; at?: string; repeat?: string };

/**
 * When a new alarm first rings and how it repeats, or why it cannot be set. `minuteMs` is a minute's length
 * (shorter in the local tests); `theirs` is whether the turn is answering a message of theirs.
 */
export function planAlarm(input: AlarmInput, now: number, timeZone: string, theirs: boolean, minuteMs = 60_000): { next: number; repeat: string } | { error: string } {
  const given = [input.in_minutes !== undefined, Boolean(input.at?.trim()), Boolean(input.repeat?.trim())].filter(Boolean).length;
  if (given !== 1) return { error: "Give exactly one of in_minutes, at or repeat." };
  const soonest = now + (theirs ? 1 : SELF_MIN_MINUTES) * minuteMs;
  const tooSoon = theirs ? "An alarm is at least a minute ahead." : `Not set: outside a message of theirs, an alarm is at least ${SELF_MIN_MINUTES} minutes ahead.`;
  let next: number;
  let repeat = "";
  if (input.in_minutes !== undefined) {
    const minutes = Number(input.in_minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return { error: "in_minutes is a number of minutes ahead." };
    next = now + Math.round(minutes * minuteMs);
  } else if (input.at?.trim()) {
    const at = parseAt(input.at, now, timeZone);
    if (typeof at !== "number") return at;
    next = at;
  } else {
    const rule = parseRule(input.repeat ?? "");
    if ("error" in rule) return rule;
    repeat = input.repeat!.trim().replace(/\s+/g, " ").toLowerCase();
    // An hourly one starts one step from now; a wall-clock one at its next time that is far enough ahead.
    next = nextRing(rule, now, Math.max(now, soonest - 1), timeZone);
  }
  if (next < soonest) return { error: next <= now ? "That time has passed." : tooSoon };
  if (next > now + AHEAD_MAX_DAYS * 86400_000) return { error: "At most a year ahead." };
  return { next, repeat };
}

export function alarmNote(alarm: Alarm, now: string, setAt: string): string {
  const repeats = alarm.repeat ? `It repeats (${alarm.repeat}) until you cancel it (id ${alarm.id}).` : "It rang once and is gone now.";
  return `${ALARM_PREFIX}; it is now ${now}.) You set it on ${setAt} with this note:
<<<
${alarm.note}
>>>
${repeats} If you would like to reach out to them, write exactly what you want to send, as in any chat. If now is a bad time to disturb them (they may be asleep or busy), or you have nothing to say, reply with just the four letters SKIP.`;
}

function hex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const alarmOf = (row: Row): Alarm => ({ id: row.id, note: row.note, repeat: row.repeat, anchor: row.anchor, next: row.next_at, scheduleId: row.schedule_id, setAt: row.set_at });

export class AlarmStore {
  constructor(private readonly sql: Sql) {
    sql`CREATE TABLE IF NOT EXISTS res_alarms (id TEXT PRIMARY KEY, note TEXT NOT NULL, repeat TEXT NOT NULL, anchor INTEGER NOT NULL,
      next_at INTEGER NOT NULL, schedule_id TEXT NOT NULL, set_at INTEGER NOT NULL)`;
    sql`CREATE TABLE IF NOT EXISTS res_alarm_rings (at INTEGER NOT NULL)`;
    sql`CREATE TABLE IF NOT EXISTS res_alarm_ring_jobs (key TEXT PRIMARY KEY, at INTEGER NOT NULL)`;
    sql`INSERT OR IGNORE INTO res_alarm_ring_jobs SELECT 'legacy_' || rowid, at FROM res_alarm_rings`;
  }

  all(): Alarm[] {
    return this.sql<Row>`SELECT * FROM res_alarms ORDER BY next_at`.map(alarmOf);
  }

  get(id: string): Alarm | null {
    const [row] = this.sql<Row>`SELECT * FROM res_alarms WHERE id = ${id}`;
    return row ? alarmOf(row) : null;
  }

  add(note: string, next: number, repeat: string, now: number): Alarm | { error: string } {
    const text = note.trim().slice(0, NOTE_MAX);
    if (!text) return { error: "Write a note: what the alarm is for, so you know when it rings." };
    if (this.all().length >= MAX_ALARMS) return { error: `Not set: you already have ${MAX_ALARMS} alarms. Cancel one first (list_alarms shows them).` };
    const id = `a_${hex(4)}`;
    this.sql`INSERT INTO res_alarms VALUES (${id}, ${text}, ${repeat}, ${now}, ${next}, ${""}, ${now})`;
    return this.get(id)!;
  }

  next(id: string, next: number): void {
    this.sql`UPDATE res_alarms SET next_at = ${next} WHERE id = ${id}`;
  }

  armed(id: string, next: number, scheduleId: string): void {
    this.sql`UPDATE res_alarms SET next_at = ${next}, schedule_id = ${scheduleId} WHERE id = ${id}`;
  }

  remove(id: string): boolean {
    const had = Boolean(this.get(id));
    this.sql`DELETE FROM res_alarms WHERE id = ${id}`;
    return had;
  }

  /** Count a ring once under its stable alarm-and-time key. */
  ring(now: number, key: string): boolean {
    this.sql`DELETE FROM res_alarm_ring_jobs WHERE at < ${now - 86400_000}`;
    const [existing] = this.sql<{ key: string }>`SELECT key FROM res_alarm_ring_jobs WHERE key = ${key}`;
    if (existing) return true;
    const [row] = this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM res_alarm_ring_jobs`;
    if ((row?.n ?? 0) >= RINGS_PER_DAY) return false;
    this.sql`INSERT INTO res_alarm_ring_jobs (key, at) VALUES (${key}, ${now})`;
    return true;
  }

  releaseRing(key: string): void {
    this.sql`DELETE FROM res_alarm_ring_jobs WHERE key = ${key}`;
  }
}
