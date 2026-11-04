// Run: node --test test/fcm.mjs. Keys exist only in memory; no Firebase credentials required.
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transform } from "esbuild";

const source = readFileSync(new URL("../src/fcm.ts", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "ts", target: "es2023", format: "esm" });
const { FcmClient, fcmTokenOf } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = { project_id: "test-project", client_email: "sender@test-project.iam.gserviceaccount.com", private_key_id: "test-key", private_key: keys.privateKey.export({ type: "pkcs8", format: "pem" }), token_uri: "http://127.0.0.1/never" };
const secret = JSON.stringify(account);
const token = "registration:ABC_123-xyz.example";
const data = { title: "你好", body: "消息来了", url: "/r/test/", tag: "resident", icon: "/icon.png" };
const payload = JSON.stringify(data);
const now = 1_800_000_000_000;
const oauth = "https://oauth2.googleapis.com/token";
const endpoint = "https://fcm.googleapis.com/v1/projects/test-project/messages:send";
const opts = (fetcher, extra = {}) => ({ urgency: "high", topic: "resident", now, fetcher, ...extra });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const grant = (value = "access-secret", expires_in = 3600) => json({ access_token: value, expires_in, token_type: "Bearer" });

function mock() {
  const calls = [];
  let status = 200;
  let result = {};
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return url === oauth ? grant(`access-${calls.filter(c => c.url === oauth).length}`) : json(result, status);
  };
  return { calls, fetcher, reply(s, r = {}) { status = s; result = r; }, exchanges() { return calls.filter(c => c.url === oauth).length; } };
}

test("registration tokens: opaque ASCII, bounded and no control characters", () => {
  for (const value of [token, "a", "a".repeat(4096)]) assert.equal(fcmTokenOf(value), value);
  for (const value of [null, {}, 123, "", "a".repeat(4097), "a\n", "a\r", "a\0", "a\t", "a b", "a\x7f", "中文", "a/", "a?", "a\u0085"]) assert.equal(fcmTokenOf(value), null);
});

test("real RSA signature, JWT claims, fixed endpoints and HTTP v1 message", async () => {
  const m = mock();
  assert.deepEqual(await new FcmClient().send(secret, token, payload, opts(m.fetcher)), { ok: true });
  assert.equal(m.calls.length, 2);
  const exchange = m.calls[0];
  assert.equal(exchange.url, oauth);
  assert.equal(exchange.init.method, "POST");
  assert.equal(exchange.init.redirect, "error");
  assert.equal(new Headers(exchange.init.headers).get("content-type"), "application/x-www-form-urlencoded");
  const form = new URLSearchParams(exchange.init.body);
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const [head, claims, signature] = form.get("assertion").split(".");
  assert.deepEqual(JSON.parse(Buffer.from(head, "base64url")), { alg: "RS256", typ: "JWT", kid: "test-key" });
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url")), { iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: oauth, iat: now / 1000, exp: now / 1000 + 3600 });
  assert.equal(verify("RSA-SHA256", Buffer.from(`${head}.${claims}`), keys.publicKey, Buffer.from(signature, "base64url")), true);
  const send = m.calls[1];
  assert.equal(send.url, endpoint);
  assert.equal(send.init.method, "POST");
  assert.equal(send.init.redirect, "error");
  assert.equal(new Headers(send.init.headers).get("authorization"), "Bearer access-1");
  assert.equal(new Headers(send.init.headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(send.init.body), { message: { token, notification: { title: data.title, body: data.body }, data, android: { priority: "high", collapse_key: "resident" } } });
});

test("cache remains valid until expires_in minus 60 seconds, refreshes at boundary", async () => {
  const m = mock(), client = new FcmClient();
  for (const delta of [0, 3_539_999, 3_540_000]) assert.deepEqual(await client.send(secret, token, payload, opts(m.fetcher, { now: now + delta, urgency: "normal" })), { ok: true });
  assert.equal(m.exchanges(), 2);
  assert.equal(JSON.parse(m.calls.at(-1).init.body).message.android.priority, "normal");
});

test("account rotation including private key changes invalidates cache; clients are independent", async () => {
  const m = mock(), client = new FcmClient();
  await client.send(secret, token, payload, opts(m.fetcher));
  const changed = { ...account, client_email: "other@test-project.iam.gserviceaccount.com" };
  await client.send(JSON.stringify(changed), token, payload, opts(m.fetcher));
  const newKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  changed.private_key = newKeys.privateKey.export({ type: "pkcs8", format: "pem" });
  await client.send(JSON.stringify(changed), token, payload, opts(m.fetcher));
  await new FcmClient().send(secret, token, payload, opts(m.fetcher));
  assert.equal(m.exchanges(), 4);
});

test("missing secret skips before validation or fetch; removing secret clears cache", async () => {
  const m = mock(), client = new FcmClient();
  await client.send(secret, token, payload, opts(m.fetcher));
  for (const value of [undefined, "", "  "]) assert.deepEqual(await client.send(value, "bad token", "bad json", opts(m.fetcher)), { skipped: true });
  await client.send(secret, token, payload, opts(m.fetcher));
  assert.equal(m.exchanges(), 2);
});

test("404 and typed UNREGISTERED mean gone; other 400/403 errors preserve target", async () => {
  const m = mock(), client = new FcmClient();
  for (const status of [404, 400, 403, 429, 500]) {
    m.reply(status, { error: { message: `${token} ${account.private_key}` } });
    assert.deepEqual(await client.send(secret, token, payload, opts(m.fetcher)), status === 404 ? { gone: true } : { error: "FCM delivery failed" });
  }
  m.reply(400, { error: { details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } });
  assert.deepEqual(await client.send(secret, token, payload, opts(m.fetcher)), { gone: true });
  m.reply(400, { error: { message: "UNREGISTERED" } });
  assert.deepEqual(await client.send(secret, token, payload, opts(m.fetcher)), { error: "FCM delivery failed" });
  assert.equal(m.exchanges(), 1);
});

test("401 clears access cache for next send without immediate retry", async () => {
  const m = mock(), client = new FcmClient();
  m.reply(401);
  assert.deepEqual(await client.send(secret, token, payload, opts(m.fetcher)), { error: "FCM delivery failed" });
  assert.equal(m.calls.length, 2);
  m.reply(200);
  assert.deepEqual(await client.send(secret, token, payload, opts(m.fetcher)), { ok: true });
  assert.equal(m.exchanges(), 2);
});

test("a broken secret or key fails before any request", async () => {
  const m = mock();
  for (const value of ["{", "null", "[]", "{}", JSON.stringify({ ...account, private_key: "not a key" })]) {
    assert.ok("error" in await new FcmClient().send(value, token, payload, opts(m.fetcher)));
  }
  assert.equal(m.calls.length, 0);
});

test("OAuth failures, responses without a token and network exceptions are fixed errors", async () => {
  for (const response of [json({ error: account.private_key }, 403), json({}), json({ access_token: "a", expires_in: "3600" }), new Response("not json")]) {
    assert.deepEqual(await new FcmClient().send(secret, token, payload, opts(async () => response)), { error: "FCM authorization failed" });
  }
  const thrower = async () => { throw new Error(`${token} ${account.private_key}`); };
  assert.deepEqual(await new FcmClient().send(secret, token, payload, opts(thrower)), { error: "FCM authorization failed" });
  assert.deepEqual(await new FcmClient().send(secret, token, payload, opts(async url => url === oauth ? grant() : thrower())), { error: "FCM delivery failed" });
});

test("short-lived grants are never reused", async () => {
  let exchanges = 0;
  const fetcher = async url => url === oauth ? (exchanges++, grant("short", 60)) : json({});
  const client = new FcmClient();
  await client.send(secret, token, payload, opts(fetcher));
  await client.send(secret, token, payload, opts(fetcher));
  assert.equal(exchanges, 2);
});

test("same-account concurrent requests each own their OAuth fetch", async () => {
  const releases = [];
  const fetcher = async url => url === oauth ? new Promise(resolve => releases.push(() => resolve(grant()))) : json({});
  const client = new FcmClient();
  const first = client.send(secret, token, payload, opts(fetcher));
  const second = client.send(secret, token, payload, opts(fetcher));
  while (releases.length < 2) await new Promise(resolve => setImmediate(resolve));
  for (const release of releases) release();
  assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
  assert.equal(releases.length, 2);
});
