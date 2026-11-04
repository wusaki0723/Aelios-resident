// Notifications to the Android app through FCM HTTP v1, with WebCrypto and fetch only. One client lives on the
// Resident and keeps the access token until it runs out or the secret changes.
const OAUTH_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TIMEOUT_MS = 10_000;
const encoder = new TextEncoder();

type FcmResult = { ok: true } | { gone: true } | { skipped: true } | { error: string };
type Account = { project_id: string; client_email: string; private_key: string; private_key_id?: string };

/** A registration token the app hands over: plain ASCII, no spaces or control characters. */
export function fcmTokenOf(value: unknown): string | null {
  return typeof value === "string" && value.length <= 4096 && /^[A-Za-z0-9_:.-]+$/.test(value) ? value : null;
}

export class FcmClient {
  private cached: { secret: string; token: string; until: number } | undefined;

  /** secret is the service account JSON (FCM_SERVICE_ACCOUNT); without one nothing is sent. Never throws, and an
   * error never carries the secret, a token or what Google said. now and fetcher are for the tests. */
  async send(
    secret: string | undefined,
    token: string,
    payload: string,
    options: { urgency: "high" | "normal"; topic: string; fetcher?: typeof fetch; now?: number }
  ): Promise<FcmResult> {
    if (!secret?.trim()) {
      this.cached = undefined;
      return { skipped: true };
    }
    const fetcher = options.fetcher ?? fetch;
    const now = options.now ?? Date.now();
    let stage = "invalid FCM configuration";
    try {
      const account = JSON.parse(secret) as Account;
      if (typeof account?.project_id !== "string" || typeof account.client_email !== "string" || typeof account.private_key !== "string") {
        return { error: stage };
      }
      const message = JSON.parse(payload) as Record<string, unknown>;
      const data: Record<string, string> = {};
      for (const field of ["title", "body", "url", "tag", "icon"]) data[field] = String(message[field] ?? "");

      stage = "FCM authorization failed";
      let access = this.cached;
      if (!access || access.secret !== secret || now >= access.until) {
        const response = await fetcher(OAUTH_URL, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await jwt(account, now) }).toString()
        });
        const grant = response.ok ? ((await response.json()) as { access_token?: unknown; expires_in?: unknown }) : null;
        if (typeof grant?.access_token !== "string" || typeof grant.expires_in !== "number") return { error: stage };
        access = { secret, token: grant.access_token, until: now + (grant.expires_in - 60) * 1000 };
        this.cached = access;
      }

      stage = "FCM delivery failed";
      const response = await fetcher(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${access.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: {
          token,
          notification: { title: data.title, body: data.body },
          data,
          android: { priority: options.urgency, collapse_key: options.topic }
        } })
      });
      if (response.ok) return { ok: true };
      if (response.status === 401) this.cached = undefined;
      // The app was removed or its token dropped: 404, or UNREGISTERED in the error's details.
      const failure = (await response.json().catch(() => null)) as { error?: { details?: { errorCode?: string }[] } } | null;
      if (response.status === 404 || failure?.error?.details?.some((detail) => detail?.errorCode === "UNREGISTERED")) return { gone: true };
      return { error: stage };
    } catch {
      return { error: stage };
    }
  }
}

async function jwt(account: Account, now: number): Promise<string> {
  const pem = account.private_key.replace(/-----[A-Z ]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
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
