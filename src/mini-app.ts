// The web page opened inside Telegram as a Mini App. It never sees WEB_KEY; instead it proves who it is with
// Telegram.WebApp.initData, which Telegram signs with the bot token (core.telegram.org/bots/webapps,
// "Validating data received via the Mini App"). Only the signed string is trusted, never initDataUnsafe.
//
//   x-telegram-init-data: <initData>      accepted on any /web/* call while auth_date is fresh (INIT_DATA_TTL)
//   POST /web/session  (same header)       → { token, expiresAt, user }: a short stateless session, so a Mini App
//                                            left open longer than initData stays valid keeps working
//   POST /web/session  (authorization: Bearer <token>)   → a fresh token, up to SESSION_MAX_AGE after the login
//   authorization: Bearer <token>          accepted on any /web/* call until expiresAt
//
// Every request, whichever way it comes, is checked against TG_ALLOWED as in effect at that moment. The session is
// signed with a key derived from the bot token, so changing TG_BOT_TOKEN ends every session at once.

import { isAllowed, timingSafeEqual } from "./telegram";

/** How old initData may be (from its auth_date) to log in or to be used directly. */
export const INIT_DATA_TTL_SECONDS = 24 * 60 * 60;
/** How long one session token lasts; the page renews it before then. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
/** Renewing stops this long after the initData it started from; then the Mini App has to be reopened. */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
// Telegram's clock and ours may disagree a little.
const CLOCK_SKEW_SECONDS = 60;
const TOKEN_PREFIX = "tma1.";
const SESSION_KEY_LABEL = "aelios-resident/mini-app-session/v1";
const MAX_INIT_DATA = 8192;
const MAX_TOKEN = 2048;

export type MiniAppUser = { id: number; username?: string; first_name?: string };

type SessionClaims = {
  /** Telegram user id */
  uid: number;
  /** @username when the token was issued, for TG_ALLOWED entries written as @name */
  un?: string;
  /** auth_date of the initData the session started from */
  auth: number;
  iat: number;
  exp: number;
};

const encoder = new TextEncoder();

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", imported, encoder.encode(data));
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

const now = () => Math.floor(Date.now() / 1000);

/**
 * The user from initData if Telegram signed it with this bot token and it is fresh, else null.
 * Says nothing about TG_ALLOWED; see allowedUser.
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
  { maxAgeSeconds = INIT_DATA_TTL_SECONDS, at = now() }: { maxAgeSeconds?: number; at?: number } = {}
): Promise<{ user: MiniAppUser; authDate: number } | null> {
  if (!botToken || !initData || initData.length > MAX_INIT_DATA) return null;
  const fields = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(initData)) {
    // A repeated field could be read one way here and another way elsewhere.
    if (fields.has(key)) return null;
    fields.set(key, value);
  }
  const hash = fields.get("hash") ?? "";
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  fields.delete("hash");
  const dataCheckString = [...fields.keys()]
    .sort()
    .map((key) => `${key}=${fields.get(key)}`)
    .join("\n");
  const secretKey = await hmac(encoder.encode("WebAppData"), botToken);
  if (!timingSafeEqual(hex(await hmac(secretKey, dataCheckString)), hash)) return null;

  const authDate = Number(fields.get("auth_date"));
  if (!Number.isSafeInteger(authDate) || authDate <= 0) return null;
  if (authDate > at + CLOCK_SKEW_SECONDS || at - authDate > maxAgeSeconds) return null;

  let user: MiniAppUser;
  try {
    user = JSON.parse(fields.get("user") ?? "");
  } catch {
    return null;
  }
  if (!user || typeof user !== "object" || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
  const username = typeof user.username === "string" && user.username ? user.username : undefined;
  const firstName = typeof user.first_name === "string" ? user.first_name : undefined;
  return { user: { id: user.id, ...(username ? { username } : {}), ...(firstName ? { first_name: firstName } : {}) }, authDate };
}

async function sessionKey(botToken: string): Promise<ArrayBuffer> {
  return hmac(encoder.encode(SESSION_KEY_LABEL), botToken);
}

async function sign(botToken: string, payload: string): Promise<string> {
  return base64url(new Uint8Array(await hmac(await sessionKey(botToken), payload)));
}

/** A session token for this user, valid SESSION_TTL_SECONDS (never past SESSION_MAX_AGE after `auth`). */
export async function issueSession(
  botToken: string,
  user: { id: number; username?: string },
  auth: number,
  at = now()
): Promise<{ token: string; expiresAt: number }> {
  const exp = Math.min(at + SESSION_TTL_SECONDS, auth + SESSION_MAX_AGE_SECONDS);
  const claims: SessionClaims = { uid: user.id, ...(user.username ? { un: user.username } : {}), auth, iat: at, exp };
  const payload = base64url(encoder.encode(JSON.stringify(claims)));
  return { token: `${TOKEN_PREFIX}${payload}.${await sign(botToken, payload)}`, expiresAt: exp * 1000 };
}

/** The claims of a session token signed with this bot token and not yet expired, else null. */
export async function verifySession(token: string, botToken: string, at = now()): Promise<SessionClaims | null> {
  if (!botToken || !token.startsWith(TOKEN_PREFIX) || token.length > MAX_TOKEN) return null;
  const [payload, signature, ...rest] = token.slice(TOKEN_PREFIX.length).split(".");
  if (!payload || !signature || rest.length) return null;
  if (!timingSafeEqual(signature, await sign(botToken, payload))) return null;
  const bytes = fromBase64url(payload);
  if (!bytes) return null;
  let claims: SessionClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(claims?.uid) || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.auth)) return null;
  if (at >= claims.exp || at - claims.auth > SESSION_MAX_AGE_SECONDS) return null;
  return claims;
}

/** Whoever the Mini App request is from, if it carries valid initData or a valid session; not yet checked against TG_ALLOWED. */
export type MiniAppCaller = { user: { id: number; username?: string; first_name?: string }; auth: number; from: "initData" | "session" };

function bearer(request: Request): string {
  const match = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}

/** Reads x-telegram-init-data, then authorization: Bearer. Nothing here trusts initDataUnsafe. */
export async function miniAppCaller(request: Request, botToken: string | undefined): Promise<MiniAppCaller | null> {
  const token = botToken?.trim() ?? "";
  if (!token) return null;
  const initData = request.headers.get("x-telegram-init-data");
  if (initData) {
    const verified = await verifyInitData(initData, token);
    return verified ? { user: verified.user, auth: verified.authDate, from: "initData" } : null;
  }
  const session = bearer(request);
  if (session) {
    const claims = await verifySession(session, token);
    return claims ? { user: { id: claims.uid, ...(claims.un ? { username: claims.un } : {}) }, auth: claims.auth, from: "session" } : null;
  }
  return null;
}

/** TG_ALLOWED lists chat ids and @usernames; a private chat's id is the user's id. */
export function callerAllowed(allowed: string | undefined, caller: MiniAppCaller): boolean {
  return isAllowed(allowed, String(caller.user.id), caller.user.username);
}

/** True when the request is trying the Mini App way in (so a failure can be told apart from a missing WEB_KEY). */
export function triesMiniApp(request: Request): boolean {
  return request.headers.has("x-telegram-init-data") || Boolean(bearer(request));
}
