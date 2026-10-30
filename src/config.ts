// Settings changed on the web door instead of in Cloudflare's dashboard. A value saved there wins; an empty
// one falls back to the Worker's variable or secret of the same name, then to the code's default (README).
// Only the web door's own key, WEB_KEY, has to be in Cloudflare. A bot token saved here is connected from here, and
// the Telegram webhook secret it needs is made by the resident and kept with these settings, never shown.

import { fireUrlProblem } from "./cloud-tasks";
import { MAX_HEARTBEATS } from "./prompts";
import { LETTER_KEEP_TOKENS } from "./fold";
import { quietHoursProblem } from "./quiet-hours";
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

/**
 * Why the Claude box address cannot be used, or null. The box key, the setup token and the whole conversation go to
 * it, so only https, except to this machine itself (local tests).
 */
export const boxAddress = (value: string) => {
  try {
    const { protocol, hostname } = new URL(value);
    if (protocol === "https:") return null;
    if (protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(hostname)) return null;
    return "盒子地址要以 https:// 开头：盒子钥匙、setup token 和对话都经它送过去";
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

const letterThreshold = (value: string) =>
  Number.isSafeInteger(Number(value)) && Number(value) > LETTER_KEEP_TOKENS ? null : `要填大于 ${LETTER_KEEP_TOKENS} 的整数 token 数`;
const times = (value: string) =>
  /^(on|off)$/i.test(value) || (/^\d+$/.test(value) && Number(value) <= MAX_HEARTBEATS) ? null : `填 0 到 ${MAX_HEARTBEATS} 次，0 是不问`;
const minutes = (value: string) => (value.toLowerCase() === "off" || (Number.isFinite(Number(value)) && Number(value) >= 0) ? null : "填分钟数，或者 off");

export const FIELDS: readonly Field[] = [
  { key: "RESIDENT_NAME", kind: "text", check: (value) => (value.length <= 20 ? null : "名字最多 20 个字") },
  { key: "WEB_PUSH", kind: "choice", choices: ["on", "always", "off"] },
  { key: "CUSTOM_BASE_URL", kind: "text", check: address },
  { key: "CUSTOM_API_KEY", kind: "secret" },
  { key: "CUSTOM_FORMAT", kind: "choice", choices: ["openai", "anthropic"] },
  { key: "CLAUDE_CODE_OAUTH_TOKEN", kind: "secret", check: (value) => (/^sk-ant-oat\d*-[A-Za-z0-9_-]{20,}$/.test(value) ? null : "setup token 是 sk-ant-oat 开头的一串，在电脑上跑 claude setup-token 拿") },
  // The Claude box on a machine of her own (claude-box/, docs/claude-box.md) and the key it checks.
  { key: "CLAUDE_BOX_URL", kind: "text", check: boxAddress },
  { key: "CLAUDE_BOX_KEY", kind: "secret", check: (value) => (value.length >= 32 ? null : "盒子钥匙至少 32 位，用装盒子时生成的那把") },
  { key: "AI_GATEWAY_ID", kind: "text" },
  { key: "AELIOS_URL", kind: "text", check: address },
  { key: "AELIOS_API_KEY", kind: "secret" },
  { key: "AELIOS_NAMESPACE", kind: "text" },
  { key: "AELIOS_IDENTITY", kind: "text" },
  { key: "TG_BOT_TOKEN", kind: "secret", check: (value) => (/^\d{5,16}:[A-Za-z0-9_-]{30,}$/.test(value) ? null : "bot token 长这样：123456789:AA…，从 @BotFather 那里复制") },
  { key: "TG_ALLOWED", kind: "text" },
  // WeCom (wecom.ts): the app's keys, the relay, and who may talk to it.
  { key: "WECOM_CORP_ID", kind: "text", check: (value) => (/^w[wx][0-9a-z]{6,30}$/i.test(value) ? null : "企业 ID 是 ww 开头的一串（老企业是 wx）") },
  { key: "WECOM_AGENT_ID", kind: "text", check: (value) => (/^\d{1,12}$/.test(value) ? null : "AgentId 是一串数字") },
  { key: "WECOM_SECRET", kind: "secret" },
  { key: "WECOM_TOKEN", kind: "secret", check: (value) => (/^[A-Za-z0-9]{1,32}$/.test(value) ? null : "Token 是最多 32 位的英文字母和数字") },
  { key: "WECOM_AES_KEY", kind: "secret", check: (value) => (/^[A-Za-z0-9+/]{43}$/.test(value) ? null : "EncodingAESKey 是 43 位的英文字母和数字") },
  { key: "WECOM_RELAY_URL", kind: "text", check: address },
  { key: "WECOM_RELAY_KEY", kind: "secret", check: (value) => (value.length >= 32 ? null : "转发钥匙至少 32 位，用转发机上 install.sh 生成的那把") },
  { key: "WECOM_ALLOWED", kind: "text" },
  { key: "WECOM_STICKERS", kind: "choice", choices: ["on", "off"] },
  { key: "WECOM_STICKER_BACKGROUND", kind: "text", check: (value) => (/^#[0-9a-f]{6}$/i.test(value) || value.toLowerCase() === "none" ? null : "填一个颜色，比如 #EDEDED；不垫填 none") },
  { key: "TIME_ZONE", kind: "text", check: timeZone },
  // Checked by arming it (Resident.webSetConfig).
  { key: "CHECKIN_SCHEDULE", kind: "text" },
  { key: "HEARTBEAT", kind: "text", check: times },
  { key: "QUIET_HOURS", kind: "text", check: quietHoursProblem },
  { key: "ALARMS", kind: "choice", choices: ["on", "off"] },
  // edit_persona: it changes its own persona (persona-edit.ts).
  { key: "PERSONA_EDIT", kind: "choice", choices: ["on", "off"] },
  { key: "LETTER_IDLE_MINUTES", kind: "text", check: minutes },
  { key: "LETTER_TOKEN_THRESHOLD", kind: "text", check: letterThreshold },
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
  { key: "CLOUD_TASK_TOKEN", kind: "secret" },
  // A GitHub token with repo and workflow: the resident sets up a private repository and runs jobs there on Actions.
  { key: "CLOUD_TASK_GITHUB_TOKEN", kind: "secret" },
  // Which model the threads work with, here and on GitHub Actions. Empty: Workers AI's glm-4.7-flash.
  { key: "CLOUD_TASK_MODEL", kind: "text" }
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
 * The settings the code reads: saved ones over the Worker's env. Everything else (the AI and BROWSER bindings,
 * WEB_KEY) is read from env itself, whether or not the runtime lists it as a property.
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
