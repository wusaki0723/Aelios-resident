// Tests for the Mini App way into the web door (src/mini-app.ts, /web/session, /tg/setup's menu button).
// Usage:
//   node test/mini-app.mjs          unit tests, no Worker needed
//   node test/mini-app.mjs worker   also drives the local Worker (mock-server.mjs on :9999, wrangler dev on :8787
//                                   with wrangler.test.jsonc), like test/run.mjs
import assert from "node:assert/strict";
import { createHmac, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Workers have crypto.subtle.timingSafeEqual; Node does not.
if (!crypto.subtle.timingSafeEqual) {
  crypto.subtle.timingSafeEqual = (a, b) => nodeTimingSafeEqual(Buffer.from(a), Buffer.from(b));
}

mkdirSync("node_modules/.cache", { recursive: true });
const dir = mkdtempSync(join("node_modules/.cache", "resident-mini-app-"));
const entry = join(dir, "entry.ts");
writeFileSync(entry, `export * from "../../../src/mini-app";\nexport { setWebhook, MENU_BUTTON_TEXT } from "../../../src/telegram";\n`);
const out = join(dir, "mini-app.mjs");
await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error" });
const M = await import(pathToFileURL(join(process.cwd(), out)).href);
rmSync(dir, { recursive: true, force: true });

const TOKEN = "123456:test-token";
const now = () => Math.floor(Date.now() / 1000);

/** initData as Telegram builds it, signed per core.telegram.org/bots/webapps with node's own crypto. */
function initData({ token = TOKEN, user = { id: 42, first_name: "Her", username: "her_test" }, authDate = now(), extra = {}, tamper } = {}) {
  const fields = { auth_date: String(authDate), query_id: "AAH-test", user: JSON.stringify(user), signature: "ed25519-not-checked-here", ...extra };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  const signed = { ...fields, hash, ...(tamper ?? {}) };
  return new URLSearchParams(signed).toString();
}

let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}\n${error.stack ?? error}`);
  }
}

await step("initData signed with the bot token is accepted, and the user comes from the signed string", async () => {
  const got = await M.verifyInitData(initData(), TOKEN);
  assert.equal(got.user.id, 42);
  assert.equal(got.user.username, "her_test");
});

await step("initData signed with another token, changed after signing, or without a hash is refused", async () => {
  assert.equal(await M.verifyInitData(initData({ token: "999:other" }), TOKEN), null);
  const forged = initData({ tamper: { user: JSON.stringify({ id: 1, username: "someone_else" }) } });
  assert.equal(await M.verifyInitData(forged, TOKEN), null, "a different user after signing");
  assert.equal(await M.verifyInitData(initData({ tamper: { auth_date: String(now() + 1) } }), TOKEN), null);
  assert.equal(await M.verifyInitData(initData({ tamper: { hash: "" } }), TOKEN), null);
  assert.equal(await M.verifyInitData(initData({ tamper: { hash: "A".repeat(64) } }), TOKEN), null, "upper-case hex is not what Telegram sends");
  assert.equal(await M.verifyInitData("", TOKEN), null);
  assert.equal(await M.verifyInitData(initData(), ""), null, "no bot token, no way in");
  assert.equal(await M.verifyInitData(`${initData()}&user=${encodeURIComponent('{"id":1}')}`, TOKEN), null, "a field given twice");
});

await step("initData older than the TTL, or from the future, is refused", async () => {
  assert.ok(await M.verifyInitData(initData({ authDate: now() - M.INIT_DATA_TTL_SECONDS + 30 }), TOKEN));
  assert.equal(await M.verifyInitData(initData({ authDate: now() - M.INIT_DATA_TTL_SECONDS - 30 }), TOKEN), null);
  assert.equal(await M.verifyInitData(initData({ authDate: now() + 600 }), TOKEN), null);
  assert.equal(await M.verifyInitData(initData({ authDate: 0 }), TOKEN), null);
});

await step("initData without a proper user is refused", async () => {
  assert.equal(await M.verifyInitData(initData({ user: { first_name: "no id" } }), TOKEN), null);
  assert.equal(await M.verifyInitData(initData({ user: { id: "42" } }), TOKEN), null);
});

await step("a session token works until it expires and only with the bot token that signed it", async () => {
  const t = now();
  const { token, expiresAt } = await M.issueSession(TOKEN, { id: 42, username: "her_test" }, t, t);
  assert.ok(token.startsWith("tma1."));
  assert.equal(expiresAt, (t + M.SESSION_TTL_SECONDS) * 1000);
  const claims = await M.verifySession(token, TOKEN, t + 10);
  assert.equal(claims.uid, 42);
  assert.equal(claims.un, "her_test");
  assert.equal(await M.verifySession(token, TOKEN, t + M.SESSION_TTL_SECONDS), null, "expired");
  assert.equal(await M.verifySession(token, "123456:new-token", t + 10), null, "a new bot token ends every session");
});

await step("a session token cannot be edited, and renewing stops SESSION_MAX_AGE after the login", async () => {
  const t = now();
  const { token } = await M.issueSession(TOKEN, { id: 42 }, t, t);
  const [, payload, sig] = token.match(/^tma1\.([^.]+)\.(.+)$/);
  const other = Buffer.from(JSON.stringify({ uid: 1, auth: t, iat: t, exp: t + 999999 })).toString("base64url");
  assert.equal(await M.verifySession(`tma1.${other}.${sig}`, TOKEN, t), null);
  assert.equal(await M.verifySession(`tma1.${payload}.${sig}x`, TOKEN, t), null);
  assert.equal(await M.verifySession(`tma1.${payload}`, TOKEN, t), null);
  // A session renewed near the end of the week does not run past it.
  const late = t + M.SESSION_MAX_AGE_SECONDS - 3600;
  const renewed = await M.issueSession(TOKEN, { id: 42 }, t, late);
  assert.equal(renewed.expiresAt, (t + M.SESSION_MAX_AGE_SECONDS) * 1000);
  assert.equal(await M.verifySession(renewed.token, TOKEN, t + M.SESSION_MAX_AGE_SECONDS), null);
});

await step("a request is read from x-telegram-init-data or authorization: Bearer, then checked against TG_ALLOWED", async () => {
  const req = (headers) => new Request("https://x/web/check", { headers });
  const viaInit = await M.miniAppCaller(req({ "x-telegram-init-data": initData() }), TOKEN);
  assert.equal(viaInit.from, "initData");
  assert.ok(M.callerAllowed("@her_test", viaInit));
  assert.ok(M.callerAllowed("7, 42", viaInit), "by user id (= the private chat id)");
  assert.ok(!M.callerAllowed("@someone", viaInit));
  assert.ok(!M.callerAllowed("", viaInit), "an empty TG_ALLOWED lets nobody in");
  const { token } = await M.issueSession(TOKEN, viaInit.user, viaInit.auth);
  const viaSession = await M.miniAppCaller(req({ authorization: `Bearer ${token}` }), TOKEN);
  assert.equal(viaSession.from, "session");
  assert.ok(M.callerAllowed("@HER_TEST", viaSession));
  assert.equal(await M.miniAppCaller(req({ authorization: `Bearer ${token}` }), "123456:new-token"), null);
  assert.equal(await M.miniAppCaller(req({ "x-telegram-init-data": "user=%7B%22id%22%3A42%7D" }), TOKEN), null, "unsigned initDataUnsafe-style data");
  assert.equal(await M.miniAppCaller(req({}), TOKEN), null);
  assert.ok(M.triesMiniApp(req({ authorization: "Bearer x" })) && !M.triesMiniApp(req({ "x-web-key": "k" })));
});

await step("setWebhook sets the menu button to the Mini App only when given its address", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ method: String(url).split("/").pop(), body: JSON.parse(init.body) });
    return Response.json({ ok: true, result: true });
  };
  try {
    const config = { token: TOKEN, apiBase: "http://mock" };
    const plain = await M.setWebhook(config, "https://r.example/messengers/telegram/webhook", "s");
    assert.deepEqual(calls.map((c) => c.method), ["setWebhook", "setMyCommands"]);
    assert.equal(plain.setChatMenuButton, undefined);
    calls.length = 0;
    const withMenu = await M.setWebhook(config, "https://r.example/messengers/telegram/webhook", "s", { miniAppUrl: "https://r.example/" });
    assert.deepEqual(calls.map((c) => c.method), ["setWebhook", "setMyCommands", "setChatMenuButton"]);
    assert.deepEqual(calls[2].body, { menu_button: { type: "web_app", text: M.MENU_BUTTON_TEXT, web_app: { url: "https://r.example/" } } });
    assert.equal(calls[2].body.chat_id, undefined, "the default menu button, for every chat");
    assert.deepEqual(withMenu.setChatMenuButton, { ok: true, result: true });
  } finally {
    globalThis.fetch = realFetch;
  }
});

if (process.argv[2] === "worker") {
  const WORKER = "http://127.0.0.1:8787";
  const MOCK = "http://127.0.0.1:9999";
  const call = (path, headers = {}, method = "GET") => fetch(`${WORKER}${path}`, { method, headers });

  await step("worker: WEB_KEY still opens the door, and gets no Mini App session", async () => {
    const check = await call("/web/check", { "x-web-key": "test-web-key" });
    assert.equal(check.status, 200);
    assert.equal((await check.json()).via, "web");
    assert.equal((await call("/web/session", { "x-web-key": "test-web-key" }, "POST")).status, 400);
    assert.equal((await call("/web/check", { "x-web-key": "wrong" })).status, 401);
  });

  let token;
  await step("worker: signed initData from someone in TG_ALLOWED opens the door and buys a session", async () => {
    const headers = { "x-telegram-init-data": initData() };
    const check = await call("/web/check", headers);
    assert.equal(check.status, 200);
    assert.equal((await check.json()).via, "telegram");
    assert.equal((await call("/web/messages", headers)).status, 200);
    const session = await call("/web/session", headers, "POST");
    assert.equal(session.status, 200);
    assert.equal(session.headers.get("cache-control"), "no-store");
    const body = await session.json();
    assert.ok(body.token.startsWith("tma1."));
    assert.ok(body.expiresAt > Date.now());
    assert.deepEqual(body.user, { id: 42, username: "her_test", first_name: "Her" });
    assert.ok(!JSON.stringify(body).includes("test-web-key"), "WEB_KEY never goes to the Mini App");
    token = body.token;
  });

  await step("worker: the session token works on its own and renews itself", async () => {
    const auth = { authorization: `Bearer ${token}` };
    assert.equal((await call("/web/messages", auth)).status, 200);
    const renewed = await call("/web/session", auth, "POST");
    assert.equal(renewed.status, 200);
    assert.ok((await renewed.json()).token.startsWith("tma1."));
    assert.equal((await call("/web/session", auth)).status, 405);
  });

  await step("worker: forged, stale, unsigned or not-allowed callers are refused", async () => {
    const refused = async (headers, why) => assert.equal((await call("/web/check", headers)).status, 401, why);
    await refused({ "x-telegram-init-data": initData({ token: "999:other" }) }, "another bot's token");
    await refused({ "x-telegram-init-data": initData({ authDate: now() - 2 * 24 * 3600 }) }, "too old");
    await refused({ "x-telegram-init-data": initData({ user: { id: 99, username: "stranger" } }) }, "not in TG_ALLOWED");
    await refused({ "x-telegram-init-data": `user=${encodeURIComponent('{"id":42,"username":"her_test"}')}&auth_date=${now()}` }, "unsigned");
    await refused({ authorization: `Bearer ${token}x` }, "edited token");
    const stranger = await M.issueSession(TOKEN, { id: 99, username: "stranger" }, now());
    await refused({ authorization: `Bearer ${stranger.token}` }, "a valid session for someone not in TG_ALLOWED");
    const otherBot = await M.issueSession("123456:old-token", { id: 42, username: "her_test" }, now());
    await refused({ authorization: `Bearer ${otherBot.token}` }, "signed with a bot token no longer in use");
    assert.equal((await call("/web/session", {}, "POST")).status, 401);
  });

  await step("worker: taking her off TG_ALLOWED shuts out her live session at once", async () => {
    const key = { "x-web-key": "test-web-key", "content-type": "application/json" };
    const before = (await (await call("/web/config", key)).json()).fields.find((f) => f.key === "TG_ALLOWED")?.value ?? "";
    const set = (text) => fetch(`${WORKER}/web/config`, { method: "POST", headers: key, body: JSON.stringify({ key: "TG_ALLOWED", text }) });
    try {
      assert.equal((await set("@someone_else")).status, 200);
      assert.equal((await call("/web/check", { authorization: `Bearer ${token}` })).status, 401);
      assert.equal((await call("/web/check", { "x-telegram-init-data": initData() })).status, 401);
    } finally {
      await set(before);
    }
    assert.equal((await call("/web/check", { authorization: `Bearer ${token}` })).status, 200);
  });

  await step("worker: /tg/setup over http leaves the menu button alone", async () => {
    await fetch(`${MOCK}/__reset`);
    assert.equal((await call("/tg/setup?secret=wrong")).status, 401);
    const response = await call("/tg/setup?secret=test-secret");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.ok(body.setChatMenuButton.skipped);
    // A script can send the secret as a header instead of in the address.
    assert.equal((await call("/tg/setup", { "x-tg-setup-secret": "test-secret" }, "POST")).status, 200);
    const log = await (await fetch(`${MOCK}/__log`)).json();
    assert.ok(log.some((e) => e.kind === "tg.setWebhook"));
    assert.ok(!log.some((e) => e.kind === "tg.setChatMenuButton"));
  });
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
