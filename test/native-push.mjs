// Execute Resident's real push methods against SQLite; transport stubs never contact providers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { build } from 'esbuild';
const source = readFileSync(new URL('../src/resident.ts', import.meta.url), 'utf8');
const names = ['pushTargets', 'pushMode', 'webPush', 'nativePushSubscribe', 'nativePushUnsubscribe', 'nativePushDeviceAdd', 'pushDevices', 'pushDeviceAdd', 'pushDeviceDrop', 'pushOut', 'push', 'pushToDevices'];
const methods = names.map(name => {
  const match = source.match(new RegExp(`^  (?:private )?(?:async )?${name}\\([^\\n]*[\\s\\S]*?^  }`, 'm'));
  assert.ok(match, `actual ${name} method exists`); return match[0];
}).join('\n');
const compiled = await build({ stdin: { contents: `
const DEFAULT_RESIDENT = 'default', PUSH_DEVICES_MAX = 10;
const fcmTokenOf = value => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,4096}$/.test(value) ? value : null;
const unmarked = text => text, dialectOf = () => '';
let webResult = { ok: true }, nativeResult = { ok: true };
const sent = [];
const sendPush = async (target, payload) => { sent.push({ channel: 'web', target, payload: JSON.parse(payload) }); return webResult; };
export class Subject {
  constructor(public sql: any, public residentId = 'default', public home?: any) {}
  cfg = {}; env = { FCM_SERVICE_ACCOUNT: 'synthetic' };
  ctx = { storage: { get: async () => 'https://resident.test' } };
  fcmClient = { send: async (secret, token, payload) => { sent.push({channel:'native', token, payload:JSON.parse(payload), secret}); return secret ? nativeResult : {skipped:true}; } };
  pushKeys = async () => ({ publicKey: 'synthetic' });
  pushHome = async () => this.home;
  webIdentity = () => ({name:'Synthetic resident'});
  ${methods}
}
export { sent };
export function result(channel, value) { if (channel === 'web') webResult = value; else nativeResult = value; }
`, loader: 'ts' }, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
const { Subject, sent, result } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const sql = (strings, ...values) => { const statement = db.prepare(strings.join('?')); if (statement.columns().length) return statement.all(...values); statement.run(...values); return []; };
  sent.length = 0; result('web', {ok:true}); result('native', {ok:true});
  return new Subject(sql);
}
const webTarget = {endpoint:'https://push.example.test/device', keys:{p256dh:'synthetic', auth:'synthetic'}};
test('native registration shares SQLite list, rotates without a phantom device, validates and unregisters from any resident', async t => {
  const home = fixture(t), other = new Subject(null, 'second', home);
  home.pushDeviceAdd(webTarget);
  assert.equal((await other.nativePushSubscribe('old:token')).devices, 2);
  assert.equal((await other.nativePushSubscribe('old:token')).devices, 2);
  assert.equal((await other.nativePushSubscribe('new:token', 'old:token')).devices, 2);
  assert.deepEqual(home.pushTargets().map(x=>x.endpoint).sort(), ['fcm:new:token',webTarget.endpoint].sort());
  assert.ok('error' in await home.nativePushSubscribe('bad\ntoken'));
  assert.ok('error' in await home.nativePushSubscribe('valid', {}));
  assert.ok('error' in await home.nativePushUnsubscribe('https://not-a-token'));
  assert.equal((await other.nativePushUnsubscribe('new:token')).devices, 1);
  assert.equal(home.pushDevices(), 1);
  assert.throws(() => other.nativePushDeviceAdd('token'));
});
test('native and browser devices obey the existing shared device cap', async t => {
  const home = fixture(t); home.pushDeviceAdd(webTarget);
  for (let i=0;i<15;i++) await home.nativePushSubscribe(`token-${i}`);
  assert.equal(home.pushDevices(), 10);
});
test('every central push fans out with identical content and resident URL; missing secret leaves web delivery working', async t => {
  const home = fixture(t), other = new Subject(null,'second',home);
  home.pushDeviceAdd(webTarget); await home.nativePushSubscribe('native:token');
  assert.deepEqual(await other.push({title:'Title',body:'Body',tag:'chat'}), {sent:2,failed:[]});
  assert.equal(sent.length, 2); assert.deepEqual(sent[0].payload,sent[1].payload);
  assert.equal(sent[0].payload.url,'/?r=second');
  sent.length = 0; home.env.FCM_SERVICE_ACCOUNT = undefined;
  assert.deepEqual(await home.push({title:'Title',body:'Body',tag:'test'}), {sent:1,failed:[]});
  assert.equal(home.pushDevices(),2);
});
test('off/on/always delivery policy applies before either transport', async t => {
  const home = fixture(t); home.pushDeviceAdd(webTarget); await home.nativePushSubscribe('native:token');
  home.cfg.WEB_PUSH='off'; await home.pushOut('alarm','proactive'); assert.equal(sent.length,0);
  home.cfg.WEB_PUSH='on'; await home.pushOut('task','delivered'); assert.equal(sent.length,0);
  await home.pushOut('checkin','proactive'); assert.equal(sent.length,2);
  home.cfg.WEB_PUSH='always'; await home.pushOut('task','delivered'); assert.equal(sent.length,4);
  await home.pushOut('reply','reply'); assert.equal(sent.length,6);
});
test('expired native devices are deleted while transient errors retain devices and web delivery continues', async t => {
  const home = fixture(t); home.pushDeviceAdd(webTarget); await home.nativePushSubscribe('native:token');
  result('native',{gone:true}); assert.equal((await home.pushToDevices('{}',{urgency:'high',topic:'chat'})).sent,1);
  assert.equal(home.pushDevices(),1);
  await home.nativePushSubscribe('native:token'); result('native',{error:'FCM unavailable'});
  const response=await home.pushToDevices('{}',{urgency:'high',topic:'chat'});
  assert.equal(response.sent,1); assert.deepEqual(response.failed,['FCM unavailable']); assert.equal(home.pushDevices(),2);
});
test('without the FCM secret a native device cannot sign up, and the page is told', async t => {
  const home = fixture(t); home.env.FCM_SERVICE_ACCOUNT = '';
  assert.match((await home.nativePushSubscribe('native:token')).error, /FCM_SERVICE_ACCOUNT/);
  assert.equal(home.pushDevices(), 0);
  assert.equal((await home.webPush()).native, false);
  home.env.FCM_SERVICE_ACCOUNT = 'synthetic';
  assert.equal((await home.webPush()).native, true);
});
