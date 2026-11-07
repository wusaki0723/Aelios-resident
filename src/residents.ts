// More than one resident on one Worker. Each is its own Durable Object, found by name: its conversation, persona,
// model, settings, stickers, alarms and notifications are all its own. "default" is the first one and keeps every
// address it always had; another one's addresses start with /r/<id> (its Telegram webhook, its task reports, its
// MCP sign-ins, its avatar and stickers, its web API), and its web page is /?r=<id>. The default resident keeps the
// list of the others (Resident.residentIds), and the Worker answers only for the ones on it.

export const DEFAULT_RESIDENT = "default";
// The others, besides the default one.
export const RESIDENTS_MAX = 8;
const ID = "[a-z][a-z0-9-]{0,23}";
const ID_ONLY = new RegExp(`^${ID}$`);
const IN_PATH = new RegExp(`^/r/(${ID})(/.*)?$`);
const IN_BASE = new RegExp(`^(.*)/r/(${ID})$`);

/** Why this cannot be a new resident's id, or null when it can. */
export function residentIdProblem(id: string): string | null {
  if (!ID_ONLY.test(id)) return "代号要小写英文字母开头，只用小写字母、数字和 -，最多 24 个";
  if (id === DEFAULT_RESIDENT) return "default 是第一个住户的代号";
  return null;
}

/** What a resident's addresses start with: nothing for the default one. */
export function residentPrefix(id: string): string {
  return id === DEFAULT_RESIDENT ? "" : `/r/${id}`;
}

/** The resident an address is for, and the address as that resident knows it: /r/<id>/rest is <id>'s /rest. */
export function residentOfPath(pathname: string): { id: string; path: string } {
  const match = pathname.match(IN_PATH);
  if (!match) return { id: DEFAULT_RESIDENT, path: pathname };
  return { id: match[1], path: match[2] ?? "/" };
}

/** Where a resident's web page opens, from its address (origin plus prefix): /r/<id> becomes /?r=<id>. */
export function residentPage(base: string): string {
  const match = base.match(IN_BASE);
  return match ? `${match[1]}/?r=${match[2]}` : `${base}/`;
}

/**
 * Settings that belong to one resident. The default resident reads them from the Worker's variables too, as it
 * always did; another one only from its own settings page, so it does not answer on the default resident's bot,
 * WeCom app or scheduled task, or speak as its Aelios identity. Its identity is its id until one is set, and its
 * memory space that identity's (Aelios' own default for an identity); it does not check in by itself until told to.
 */
const OWN: Partial<Record<keyof Env & string, (id: string, saved: Record<string, string>) => string>> = {
  RESIDENT_NAME: () => "",
  TG_BOT_TOKEN: () => "",
  TG_WEBHOOK_SECRET: () => "",
  TG_BOT_USERNAME: () => "",
  WECOM_AGENT_ID: () => "",
  WECOM_SECRET: () => "",
  WECOM_TOKEN: () => "",
  WECOM_AES_KEY: () => "",
  AELIOS_IDENTITY: (id) => id,
  AELIOS_NAMESPACE: (id, saved) => saved.AELIOS_IDENTITY?.trim() || id,
  CHECKIN_SCHEDULE: () => "",
  HEARTBEAT: () => "0"
};

/** The Worker's env as a resident sees it under its own settings (config.ts withSaved goes on top of this). */
export function residentEnv(env: Env, id: string, saved: Record<string, string>): Env {
  if (id === DEFAULT_RESIDENT) return env;
  return new Proxy(env, {
    get: (target, key) => {
      const own = typeof key === "string" ? OWN[key as keyof typeof OWN] : undefined;
      return own ? own(id, saved) : Reflect.get(target, key);
    }
  });
}
