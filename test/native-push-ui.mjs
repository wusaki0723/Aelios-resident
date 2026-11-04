// Execute the actual frontend with a mocked Capacitor bridge; no Worker, keys or native device needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const code = readFileSync('public/app.js', 'utf8');
const copy = (value) => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
function harness({ store = new Map(), native = true, pluginMissing = false } = {}) {
  const calls = [], listeners = {}, notices = [];
  const counts = { check: 0, request: 0, register: 0, web: 0 };
  const bridge = {
    permission: 'granted', requested: 'granted', token: 'token-a',
    async addListener(name, fn) { (listeners[name] ||= []).push(fn); return { remove() {} }; },
    async checkPermissions() { counts.check++; return { receive: this.permission }; },
    async requestPermissions() { counts.request++; return { receive: this.requested }; },
    async register() { counts.register++; if (this.token) await emit('registration', { value: this.token }); }
  };
  async function emit(name, event) { for (const fn of listeners[name] || []) fn(event); await tick(); }
  const context = vm.createContext({
    document: { documentElement: { dataset: { theme: 'dark' } } },
    localStorage: { getItem: (key) => store.get(key) || '', setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) },
    navigator: { userAgent: '', serviceWorker: {
      register() { counts.web++; if (native) throw Error('Native must not use Service Worker'); return Promise.resolve({}); },
      getRegistration() { counts.web++; if (native) throw Error('Native must not use Web Push'); return Promise.resolve(null); }
    } },
    window: { isSecureContext: true, PushManager: {}, Notification: {}, Capacitor: { isNativePlatform: () => native, Plugins: pluginMissing ? {} : { PushNotifications: bridge } } },
    Notification: { permission: 'default', requestPermission() { counts.web++; throw Error('Native must not use Notification'); } },
    fetch: async (url, options) => {
      calls.push({ url, options: copy(options || {}) });
      return h.respond(url, options);
    },
    setTimeout, clearTimeout, console, Date, URL, URLSearchParams, Blob, TextDecoder, TextEncoder, atob, btoa
  });
  vm.runInContext(code, context);
  const page = vm.runInContext('resident()', context);
  page.authed = true; page.key = 'synthetic-session-key'; page.notify = (message) => notices.push(message);
  const h = { page, context, calls, store, bridge, counts, listeners, emit, notices,
    respond: async () => ({ ok: true, json: async () => ({ devices: 2 }) }) };
  page.preparePush();
  return h;
}
await test('native enables via permission/register and root native route, never Web Push', async () => {
  const h = harness();
  h.page.resident = 'another';
  await h.page.enablePush(); await tick();
  assert.equal(h.page.push.native, true); assert.equal(h.page.push.on, true);
  assert.equal(h.store.get('resident.push.native.token'), 'token-a');
  assert.equal(h.store.get('resident.push.native.enabled'), 'yes');
  assert.ok(h.calls.length > 0);
  for (const call of h.calls) {
    assert.equal(call.url, '/web/push/native/subscribe');
    assert.deepEqual(JSON.parse(call.options.body), { token: 'token-a' });
    assert.equal(call.options.headers['x-web-key'], 'synthetic-session-key');
  }
  assert.equal(h.counts.web, 0);
  assert.ok(!JSON.stringify([...h.store]).includes('synthetic-session-key'));
});
await test('listeners install once and token refresh replaces the previous token', async () => {
  const h = harness(); await h.page.enablePush();
  h.page.preparePush(); await h.page.listenNativePush(); await h.page.loadPushState();
  assert.equal(h.listeners.registration.length, 1); assert.equal(h.listeners.registrationError.length, 1);
  assert.deepEqual(Object.keys(h.listeners).sort(), ['registration', 'registrationError']);
  await h.emit('registration', { value: 'token-b' });
  assert.deepEqual(JSON.parse(h.calls.at(-1).options.body), { token: 'token-b', previousToken: 'token-a' });
  assert.equal(h.store.get('resident.push.native.registered'), 'token-b');
});
await test('persisted token re-registers after reload without another token event or permission prompt', async () => {
  const h = harness(); await h.page.enablePush();
  const next = harness({ store: h.store }); next.bridge.token = '';
  await next.page.loadPushState();
  assert.equal(next.page.push.on, true); assert.equal(next.counts.request, 0);
  assert.ok(next.calls.some((c) => c.url === '/web/push/native/subscribe'));
});
await test('disabled preference survives resident switch/reload and late token events', async () => {
  const h = harness(); await h.page.enablePush(); await h.page.disablePush();
  assert.equal(h.page.push.on, false);
  assert.equal(h.calls.at(-1).url, '/web/push/native/unsubscribe');
  await h.emit('registration', { value: 'new-disabled-token' });
  const next = harness({ store: h.store }); next.page.resident = 'another'; await next.page.loadPushState();
  assert.equal(next.counts.register, 0); assert.equal(next.counts.request, 0);
  assert.equal(next.page.push.on, false);
  assert.ok(next.calls.every((c) => c.url.endsWith('/web/push')));
});
await test('permission denial has a specific safe error and never registers', async () => {
  const h = harness(); h.bridge.permission = 'prompt'; h.bridge.requested = 'denied';
  await h.page.enablePush();
  assert.equal(h.counts.request, 1); assert.equal(h.counts.register, 0);
  assert.equal(h.page.push.on, false); assert.equal(h.page.push.busy, false);
  assert.match(h.page.push.error, /系统设置/); assert.equal(h.calls.length, 0);
});
await test('registration promise failure and registrationError cannot show token-bearing platform errors', async () => {
  const h = harness();
  h.bridge.register = async () => { throw Error('private-token synthetic-session-key'); };
  await h.page.enablePush(); assert.match(h.page.push.error, /注册失败/);
  assert.ok(!h.page.push.error.includes('private-token')); assert.equal(h.page.push.on, false);
  h.bridge.register = async () => { await h.emit('registrationError', { error: 'private-token' }); };
  await h.page.enablePush(); assert.equal(h.page.push.on, false); assert.match(h.page.push.error, /注册失败/);
  assert.equal(h.page.push.busy, false);
});
await test('registration waits for a token and an eventual event completes enrollment', async () => {
  const h = harness(); h.bridge.token = '';
  await h.page.enablePush(); assert.equal(h.page.push.pending, true); assert.equal(h.page.push.on, false);
  await h.emit('registration', { value: 'delayed-token' });
  assert.equal(h.page.push.on, true); assert.equal(h.page.push.pending, false);
});
await test('subscribe failure leaves token retryable, refresh retries with safe UI', async () => {
  const h = harness(); h.respond = async () => { throw Error('network-secret'); };
  await h.page.enablePush(); await tick();
  assert.equal(h.page.push.on, false); assert.match(h.page.push.error, /登记失败/);
  assert.ok(!h.page.push.error.includes('network-secret'));
  h.respond = async () => ({ ok: true, json: async () => ({ devices: 4 }) });
  h.bridge.token = ''; await h.page.loadPushState();
  assert.equal(h.page.push.on, true); assert.equal(h.page.push.devices, 4);
});
await test('after logout a late token event signs nothing up', async () => {
  const h = harness(); await h.page.enablePush(); h.calls.length = 0;
  h.page.logout(); await h.emit('registration', { value: 'after-logout' });
  assert.equal(h.page.key, ''); assert.equal(h.page.authed, false);
  assert.equal(h.calls.length, 0);
  assert.ok(!JSON.stringify([...h.store]).includes('synthetic-session-key'));
});
await test('a turn-off the server did not hear stays on and says so', async () => {
  const h = harness(); await h.page.enablePush();
  h.respond = async () => ({ ok: false, json: async () => ({ error: 'secret-response' }) });
  await h.page.disablePush();
  assert.match(h.page.push.error, /关闭通知同步失败/); assert.ok(!h.page.push.error.includes('secret-response'));
  assert.equal(h.page.push.on, true); assert.equal(h.store.get('resident.push.native.enabled'), 'yes');
  h.respond = async () => ({ ok: true, json: async () => ({ devices: 0 }) });
  await h.page.disablePush();
  assert.equal(h.page.push.on, false); assert.equal(h.calls.at(-1).url, '/web/push/native/unsubscribe');
});
await test('browser Capacitor shim preserves Web Push detection and missing native plugin reports error', async () => {
  const web = harness({ native: false }); await web.page.loadPushState();
  assert.equal(web.page.push.native, false); assert.equal(web.page.push.supported, true);
  assert.ok(web.counts.web >= 2); assert.equal(web.counts.register, 0);
  const missing = harness({ pluginMissing: true }); await missing.page.loadPushState();
  assert.equal(missing.page.push.supported, false); assert.match(missing.page.push.error, /更新 App/);
  assert.equal(missing.counts.web, 0);
});
await test('logout during permission checking cannot prompt or register later', async () => {
  const h = harness(); let finish;
  h.bridge.checkPermissions = () => new Promise((resolve) => { finish = resolve; });
  const enabling = h.page.enablePush(); await tick(); assert.ok(finish);
  h.page.logout(); finish({ receive: 'prompt' }); await enabling; await tick();
  assert.equal(h.counts.request, 0); assert.equal(h.counts.register, 0);
  assert.equal(h.page.push.on, false);
  assert.ok(h.calls.every((c) => !c.url.endsWith('/subscribe')));
});
await test('a Worker without the FCM secret says so and offers no switch', async () => {
  const h = harness();
  h.respond = async () => ({ ok: true, json: async () => ({ devices: 0, native: false }) });
  await h.page.loadPushState();
  assert.equal(h.page.push.supported, false); assert.equal(h.page.push.on, false);
  assert.match(h.page.push.error, /FCM_SERVICE_ACCOUNT/);
  assert.equal(h.counts.request, 0); assert.equal(h.counts.register, 0);
  assert.ok(h.calls.every((c) => c.url.endsWith('/web/push')));
});
console.log(`${passed} native push frontend regression groups passed`);
