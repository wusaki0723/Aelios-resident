// FCM HTTP v1 using only WebCrypto and fetch. Keep one client on the Resident;
// only completed credentials are cached, never request-owned I/O promises.
const OAUTH_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const encoder = new TextEncoder();

type FcmResult = { ok: true } | { gone: true } | { skipped: true } | { error: string };
type Account = { project_id: string; client_email: string; private_key: string; private_key_id?: string };
type CachedToken = { account: string; token: string; until: number };

/** FCM registration tokens are opaque ASCII strings; reject spaces, controls and oversized input. */
export function fcmTokenOf(value: unknown): string | null {
  return typeof value === "string" && value.length >= 1 && value.length <= 4096 && /^[A-Za-z0-9_:.-]+$/.test(value) ? value : null;
}

export class FcmClient {
  private account: string | undefined;
  private cached: CachedToken | undefined;

  /** now is milliseconds since Unix epoch. topic is the Android collapse key, not a destination. Never throws. */
  async send(
    serviceAccount: string | undefined,
    token: string,
    payload: string,
    options: { urgency: "high" | "normal"; topic: string; fetcher?: typeof fetch; now?: number }
  ): Promise<FcmResult> {
    if (!serviceAccount?.trim()) {
      this.account = undefined;
      this.cached = undefined;
      return { skipped: true };
    }
    let stage = "invalid FCM configuration";
    try {
      // Include every service-account field in the identity, including changed private keys.
      const fingerprint = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(serviceAccount))));
      if (this.account !== fingerprint) {
        this.account = fingerprint;
        this.cached = undefined;
      }
      const account = accountOf(JSON.parse(serviceAccount));
      if (!account) return { error: stage };
      if (!fcmTokenOf(token)) return { error: "invalid FCM registration token" };
      const now = options.now ?? Date.now();
      if (!Number.isFinite(now) || now < 0) return { error: "invalid FCM time" };
      if (!["high", "normal"].includes(options.urgency) || !/^[A-Za-z0-9_-]{1,32}$/.test(options.topic)) {
        return { error: "invalid FCM delivery options" };
      }
      stage = "invalid FCM payload";
      const input: unknown = JSON.parse(payload);
      if (!isRecord(input) || typeof input.title !== "string" || typeof input.body !== "string") return { error: stage };
      const data: Record<string, string> = {};
      for (const field of ["title", "body", "url", "tag", "icon"]) {
        const value = input[field];
        if (value !== undefined && typeof value !== "string") return { error: stage };
        data[field] = typeof value === "string" ? value : "";
      }
      const body = JSON.stringify({ message: {
        token,
        notification: { title: data.title, body: data.body },
        data,
        android: { priority: options.urgency, collapse_key: options.topic }
      } });
      // FCM's limit includes both notification and data keys/values. Bound the full envelope conservatively.
      if (encoder.encode(body).length > 4096) return { error: "FCM payload too large" };
      const fetcher = options.fetcher ?? fetch;
      stage = "FCM authorization failed";
      let access = this.cached;
      if (!access || access.account !== fingerprint || now >= access.until) {
        const assertion = await jwt(account, now);
        const response = await fetcher(OAUTH_URL, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString()
        });
        if (!response.ok) {
          await response.body?.cancel();
          return { error: stage };
        }
        const result = await boundedJson(response);
        if (!isRecord(result) || typeof result.access_token !== "string" ||
            !/^[\x21-\x7e]{1,8192}$/.test(result.access_token) ||
            typeof result.expires_in !== "number" || !Number.isFinite(result.expires_in) || result.expires_in <= 0 ||
            (result.token_type !== undefined && String(result.token_type).toLowerCase() !== "bearer")) return { error: stage };
        access = { account: fingerprint, token: result.access_token, until: now + Math.max(0, result.expires_in - 60) * 1000 };
        if (this.account === fingerprint) this.cached = access;
      }
      stage = "FCM delivery failed";
      const response = await fetcher(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${access.token}`, "Content-Type": "application/json" }, body
      });
      if (response.status === 401 && this.cached === access) this.cached = undefined;
      if (response.ok || response.status === 404) {
        await response.body?.cancel();
        return response.ok ? { ok: true } : { gone: true };
      }
      const result = await boundedJson(response).catch(() => null);
      if (isRecord(result) && isRecord(result.error) && Array.isArray(result.error.details) &&
          result.error.details.some(detail => isRecord(detail) &&
            detail["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError" && detail.errorCode === "UNREGISTERED")) {
        return { gone: true };
      }
      return { error: stage };
    } catch {
      // Never echo service responses, runtime exceptions, registration/access tokens or private keys.
      return { error: stage };
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function accountOf(value: unknown): Account | null {
  if (!isRecord(value) || typeof value.project_id !== "string" || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(value.project_id) ||
      typeof value.client_email !== "string" || !/^[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+$/.test(value.client_email) ||
      typeof value.private_key !== "string" || value.private_key.length > 16384 ||
      (value.private_key_id !== undefined && (typeof value.private_key_id !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value.private_key_id)))) return null;
  return { project_id: value.project_id, client_email: value.client_email, private_key: value.private_key,
    ...(typeof value.private_key_id === "string" ? { private_key_id: value.private_key_id } : {}) };
}

async function jwt(account: Account, now: number): Promise<string> {
  const pem = /^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----\s*$/.exec(account.private_key);
  if (!pem) throw new Error("invalid key");
  const der = Uint8Array.from(atob(pem[1].replace(/\s/g, "")), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const header = { alg: "RS256", typ: "JWT", ...(account.private_key_id ? { kid: account.private_key_id } : {}) };
  const iat = Math.floor(now / 1000);
  const claims = { iss: account.client_email, scope: SCOPE, aud: OAUTH_URL, iat, exp: iat + 3600 };
  const unsigned = `${base64url(encoder.encode(JSON.stringify(header)))}.${base64url(encoder.encode(JSON.stringify(claims)))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Read small Google JSON responses without buffering an unbounded upstream body. */
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("missing response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) {
        await reader.cancel();
        throw new Error("response too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
