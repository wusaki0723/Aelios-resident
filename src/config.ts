// Settings changed on the web door instead of in Cloudflare's dashboard. A value saved there wins; an empty
// one falls back to the Worker's variable or secret of the same name, then to the code's default (README).
// Only what is needed before the door opens stays in Cloudflare: TG_BOT_TOKEN, TG_WEBHOOK_SECRET, WEB_KEY.

import { fireUrlProblem } from "./cloud-tasks";
import { MAX_HEARTBEATS } from "./prompts";
import { VOICE_PROVIDERS, VOICE_REPLIES } from "./voice";

type Kind = "text" | "secret" | "choice";

type Field = {
  key: keyof Env & string;
  kind: Kind;
  choices?: readonly string[];
  /** Why a value cannot be saved, or null when it can. */
  check?: (value: string) => string | null;
};

const address = (value: string) => {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:" ? null : "要以 https:// 开头";
  } catch {
    return "不是一个网址";
  }
};

const timeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return null;
  } catch {
    return "不认识这个时区，写成 Asia/Singapore 这样";
  }
};

const count = (value: string) => (Number.isFinite(Number(value)) && Number(value) > 0 ? null : "要填一个大于 0 的数");
const times = (value: string) =>
  /^(on|off)$/i.test(value) || (/^\d+$/.test(value) && Number(value) <= MAX_HEARTBEATS) ? null : `填 0 到 ${MAX_HEARTBEATS} 次，0 是不问`;
const minutes = (value: string) => (value.toLowerCase() === "off" || (Number.isFinite(Number(value)) && Number(value) >= 0) ? null : "填分钟数，或者 off");

export const FIELDS: readonly Field[] = [
  { key: "CUSTOM_BASE_URL", kind: "text", check: address },
  { key: "CUSTOM_API_KEY", kind: "secret" },
  { key: "CUSTOM_FORMAT", kind: "choice", choices: ["openai", "anthropic"] },
  { key: "AI_GATEWAY_ID", kind: "text" },
  { key: "AELIOS_URL", kind: "text", check: address },
  { key: "AELIOS_API_KEY", kind: "secret" },
  { key: "AELIOS_NAMESPACE", kind: "text" },
  { key: "AELIOS_IDENTITY", kind: "text" },
  { key: "TG_ALLOWED", kind: "text" },
  { key: "TIME_ZONE", kind: "text", check: timeZone },
  // Checked by arming it (Resident.webSetConfig).
  { key: "CHECKIN_SCHEDULE", kind: "text" },
  { key: "HEARTBEAT", kind: "text", check: times },
  { key: "ALARMS", kind: "choice", choices: ["on", "off"] },
  { key: "LETTER_IDLE_MINUTES", kind: "text", check: minutes },
  { key: "KEEP_RECENT_TOKENS", kind: "text", check: count },
  { key: "THINKING_EFFORT", kind: "choice", choices: ["auto", "low", "medium", "high", "xhigh", "max"] },
  { key: "CACHE_TTL", kind: "choice", choices: ["1h", "5m"] },
  { key: "WEB_SEARCH", kind: "choice", choices: ["on", "off", "ceramic", "exa", "linkup"] },
  { key: "TAVILY_API_KEY", kind: "secret" },
  { key: "BRAVE_API_KEY", kind: "secret" },
  { key: "PERPLEXITY_API_KEY", kind: "secret" },
  { key: "WEB_LEARN", kind: "choice", choices: ["on", "off"] },
  { key: "WEB_FETCH", kind: "choice", choices: ["on", "off"] },
  { key: "WEB_FETCH_MODEL", kind: "text" },
  { key: "STICKERS", kind: "choice", choices: ["on", "off"] },
  { key: "VOICE_PROVIDER", kind: "choice", choices: VOICE_PROVIDERS },
  { key: "VOICE_API_KEY", kind: "secret" },
  { key: "VOICE_MODEL", kind: "text" },
  { key: "VOICE_ID", kind: "text" },
  { key: "VOICE_REPLY", kind: "choice", choices: VOICE_REPLIES },
  { key: "VOICE_BASE_URL", kind: "text", check: address },
  { key: "CLOUD_TASKS", kind: "choice", choices: ["on", "off"] },
  { key: "CLOUD_TASK_URL", kind: "text", check: fireUrlProblem },
  { key: "CLOUD_TASK_TOKEN", kind: "secret" }
];

/** One setting as the web door shows it. Secrets only say whether they are set, never what they are. */
export type ConfigField = {
  key: string;
  kind: Kind;
  choices?: readonly string[];
  /** Saved on the web door; "" when not. Always "" for a secret. */
  value: string;
  /** The Worker's own variable, used while nothing is saved; "" when unset. Always "" for a secret. */
  fromWorker: string;
  /** Secrets: whether one is saved on the web door, and whether the Worker has one. */
  saved?: boolean;
  workerHas?: boolean;
};

export function fieldOf(key: string): Field | undefined {
  return FIELDS.find((field) => field.key === key);
}

// Longer than any address, key, list or schedule needs to be.
const VALUE_MAX = 2000;

/** The value to save, or why it cannot be saved. "" clears it. */
export function cleaned(field: Field, raw: string): { value: string } | { error: string } {
  const value = raw.trim();
  if (!value) return { value };
  if (value.length > VALUE_MAX) return { error: `太长了，最多 ${VALUE_MAX} 字` };
  if (field.choices && !field.choices.includes(value.toLowerCase())) return { error: `只能填 ${field.choices.join("、")}` };
  const problem = field.check?.(value);
  return problem ? { error: problem } : { value: field.choices ? value.toLowerCase() : value };
}

/**
 * The settings the code reads: saved ones over the Worker's env. Everything else (the AI and BROWSER bindings, the
 * three secrets that stay in Cloudflare) is read from env itself, whether or not the runtime lists it as a property.
 */
export function withSaved(env: Env, saved: Record<string, string>): Env {
  return new Proxy(env, {
    get: (target, key) => (typeof key === "string" && Object.hasOwn(saved, key) ? saved[key] : Reflect.get(target, key))
  });
}

export function describe(env: Env, saved: Record<string, string>): ConfigField[] {
  return FIELDS.map((field) => {
    const own = String(env[field.key] ?? "").trim();
    if (field.kind === "secret") {
      return { key: field.key, kind: field.kind, value: "", fromWorker: "", saved: Boolean(saved[field.key]), workerHas: Boolean(own) };
    }
    return { key: field.key, kind: field.kind, ...(field.choices ? { choices: field.choices } : {}), value: saved[field.key] ?? "", fromWorker: own };
  });
}
