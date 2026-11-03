// Offline contracts: actual task/device SQLite stores and Worker routes, synthetic credentials only.
// Run: node test/desktop-devices.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { timingSafeEqual } from 'node:crypto';
// Workers extends SubtleCrypto with timingSafeEqual; provide its offline Node equivalent.
if (!crypto.subtle.timingSafeEqual) Object.defineProperty(crypto.subtle, 'timingSafeEqual', { value: (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b)) });
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

mkdirSync('node_modules/.cache', { recursive: true });
const cache = realpathSync('node_modules/.cache');
const dir = mkdtempSync(join(cache, 'desktop-contracts-'));
let device, cloud, worker;
try {
  await build({ entryPoints: ['src/desktop-devices.ts', 'src/cloud-tasks.ts'], bundle: true, platform: 'node', format: 'esm', outdir: dir, outExtension: { '.js': '.mjs' }, logLevel: 'error' });
  device = await import(pathToFileURL(join(dir, 'desktop-devices.mjs')).href);
  cloud = await import(pathToFileURL(join(dir, 'cloud-tasks.mjs')).href);
  await build({ entryPoints: ['src/index.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'worker.mjs'), logLevel: 'error', plugins: [{
    name: 'offline-runtime-boundary', setup(builder) {
      builder.onResolve({ filter: /^(agents|@cloudflare\/think\/messengers|\.\/resident|\.\/claude-box|\.\/task-worker)$/ }, args => ({ path: args.path, namespace: 'fake-runtime' }));
      builder.onLoad({ filter: /.*/, namespace: 'fake-runtime' }, args => ({ contents:
        args.path === 'agents' ? 'export async function getAgentByName(binding, id) { return binding[id]; }' :
        args.path === './resident' ? 'export class Resident {}' :
        args.path === './claude-box' ? 'export class ClaudeBox {}' :
        args.path === './task-worker' ? 'export class TaskWorker {}; export const THREAD_FILE_MAX = 8388608;' :
        'export class ThinkMessengerStateAgent {}', loader: 'js' }));
    }
  }] });
  worker = (await import(pathToFileURL(join(dir, 'worker.mjs')).href)).default;
} finally {
  const target = realpathSync(dir);
  assert.equal(resolve(target, '..'), cache);
  assert.ok(target.startsWith(join(cache, 'desktop-contracts-')));
  rmSync(target, { recursive: true });
}

function fixture() {
  const db = new DatabaseSync(':memory:');
  let failReports = false;
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    if (failReports && /INSERT OR IGNORE INTO res_desktop_reports/.test(text)) throw new Error('synthetic disk failure');
    const statement = db.prepare(text);
    return /^\s*SELECT/i.test(text) ? statement.all(...values) : (statement.run(...values), []);
  };
  const atomic = callback => { db.exec('BEGIN IMMEDIATE'); try { const result = callback(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const tasks = new cloud.TaskStore(sql);
  const devices = new device.DesktopDeviceStore(sql, tasks, atomic);
  const add = (extra = {}) => {
    const added = tasks.add({ title: 'Synthetic desktop task', job: 'Read the explicitly authorized fixture', execution: 'desktop', ...extra });
    assert.ok(!added.error); const follows = extra.follows ? tasks.get(extra.follows) : null;
    try { return devices.enqueue(added.task, follows); } catch (error) { tasks.drop(added.task.id); throw error; }
  };
  return { db, sql, atomic, tasks, devices, add, injectReportFailure(value) { failReports = value; } };
}
async function paired() { const f = fixture(); return { ...f, registration: await f.devices.register({ label: 'Synthetic device' }) }; }
function isError(code, status) { return error => error.code === code && (!status || error.status === status); }
function done(job, extra = {}) { return { eventId: 'complete-' + job.id, jobId: job.id, leaseId: job.leaseId, type: 'completed', summary: 'Synthetic completed summary', ...extra }; }

await test('registration stores only hash; safe device metadata and atomic single active registration', async () => {
  const f = fixture();
  const attempts = await Promise.allSettled([f.devices.register({ label: 'Device A' }), f.devices.register({ label: 'Device B' })]);
  assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(value => value.status === 'rejected').reason.code, 'DEVICE_EXISTS');
  const registration = attempts.find(value => value.status === 'fulfilled').value;
  assert.equal(registration.protocol, 'resident-dsh/1');
  const row = f.db.prepare('SELECT * FROM res_desktop_devices').get();
  assert.match(row.token_hash, /^[a-f0-9]{64}$/); assert.ok(!JSON.stringify(row).includes(registration.token));
  assert.ok(!JSON.stringify(f.devices.list()).includes(registration.token));
  assert.ok(!JSON.stringify(f.devices.list()).includes(row.token_hash));
  assert.equal(f.devices.list().devices[0].online, false);
});

await test('device token is resident-scoped, not a web key; malformed and revoked credentials fail', async () => {
  const a = await paired(), b = await paired();
  await assert.rejects(b.devices.request(a.registration.token, 'heartbeat', {}), isError('UNAUTHORIZED', 401));
  await assert.rejects(a.devices.request('synthetic-web-key', 'claim', {}), isError('UNAUTHORIZED', 401));
  assert.deepEqual(await a.devices.request(a.registration.token, 'heartbeat', {}), { ok: true, protocol: 'resident-dsh/1' });
  assert.equal(a.devices.list().devices[0].online, true);
  a.devices.revoke({ deviceId: a.registration.deviceId });
  await assert.rejects(a.devices.request(a.registration.token, 'heartbeat', {}), isError('UNAUTHORIZED', 401));
});

await test('explicit desktop queue requires a paired device and CLOUD_TASKS claim opt-in', async () => {
  const empty = fixture(); const raw = empty.tasks.add({ title: 'Task', job: 'fixture', execution: 'desktop' });
  assert.throws(() => empty.devices.enqueue(raw.task, null), isError('NO_DEVICE', 409));
  const f = await paired(); const task = f.add();
  await assert.rejects(f.devices.request(f.registration.token, 'claim', {}, false), isError('TASKS_DISABLED', 409));
  assert.equal(f.tasks.get(task.id).status, 'sent');
  const { job } = await f.devices.request(f.registration.token, 'claim', {});
  assert.equal(job.id, task.id); assert.equal(job.thread, task.root); assert.equal(job.attempt, 1);
  assert.equal(job.instruction, task.job); assert.ok(!JSON.stringify(job).includes(f.tasks.codeOf(task.id)));
  assert.deepEqual(await f.devices.request(f.registration.token, 'claim', {}), { job: null });
});

await test('claim survives store reconstruction and uncertainty never reissues side effects', async () => {
  const f = await paired(); const task = f.add();
  const { job } = await f.devices.request(f.registration.token, 'claim', {});
  const restarted = new device.DesktopDeviceStore(f.sql, f.tasks, f.atomic);
  assert.deepEqual(await restarted.request(f.registration.token, 'claim', {}), { job: null });
  const original = Date.now;
  try {
    Date.now = () => original() + 10 * 60_000;
    assert.deepEqual(await restarted.request(f.registration.token, 'claim', {}), { job: null });
    assert.equal(f.tasks.get(task.id).status, 'needs_you');
    assert.equal(f.db.prepare('SELECT state FROM res_desktop_jobs WHERE job_id = ?').get(task.id).state, 'unknown');
    assert.deepEqual(await restarted.request(f.registration.token, 'events', done(job)), { ok: true });
    assert.equal(f.tasks.get(task.id).status, 'done');
  } finally { Date.now = original; }
});

await test('event dedup, lease ownership, immutable session and terminal conflict checks', async () => {
  const f = await paired(), task = f.add();
  const { job } = await f.devices.request(f.registration.token, 'claim', {});
  const started = { eventId: 'start-fixture', jobId: task.id, leaseId: job.leaseId, type: 'started', sessionId: 'session_fixture' };
  await assert.rejects(f.devices.request(f.registration.token, 'events', { ...started, leaseId: 'lease_' + '0'.repeat(32) }), isError('INVALID_LEASE'));
  assert.deepEqual(await f.devices.request(f.registration.token, 'events', started), { ok: true });
  assert.deepEqual(await f.devices.request(f.registration.token, 'events', started), { ok: true, duplicate: true });
  await assert.rejects(f.devices.request(f.registration.token, 'events', { ...started, summary: 'different' }), isError('EVENT_CONFLICT'));
  await assert.rejects(f.devices.request(f.registration.token, 'events', done(job, { sessionId: 'other_session' })), isError('SESSION_CHANGED'));
  const completed = done(job, { sessionId: 'session_fixture' });
  await f.devices.request(f.registration.token, 'events', completed);
  assert.deepEqual(await f.devices.request(f.registration.token, 'events', completed), { ok: true, duplicate: true });
  assert.deepEqual(await f.devices.request(f.registration.token, 'events', { ...completed, eventId: 'another-identical-terminal' }), { ok: true, duplicate: true });
  await assert.rejects(f.devices.request(f.registration.token, 'events', { ...completed, eventId: 'conflicting', type: 'failed' }), isError('TERMINAL_CONFLICT'));
  assert.equal(f.tasks.get(task.id).status, 'done');
  assert.deepEqual(f.devices.pendingReports(), [task.id]);
  assert.equal(f.db.prepare('SELECT notices FROM res_tasks WHERE id = ?').get(task.id).notices, 1);
  const next = f.add(); const nextClaim = await f.devices.request(f.registration.token, 'claim', {});
  await assert.rejects(f.devices.request(f.registration.token, 'events', done(nextClaim.job, { eventId: 'another-identical-terminal' })), isError('EVENT_CONFLICT'));
  assert.equal(f.tasks.get(next.id).status, 'working');
});

await test('no arbitrary session URL, path, command, field or raw device token enters event storage', async () => {
  const f = await paired(); f.add(); const { job } = await f.devices.request(f.registration.token, 'claim', {});
  for (const extra of [{ cwd: '/outside' }, { sessionId: 'https://evil.example/' }, { summary: f.registration.token }, { sessionId: f.registration.token }, { eventId: f.registration.token }]) {
    await assert.rejects(f.devices.request(f.registration.token, 'events', done(job, extra)), isError('INVALID_EVENT'));
  }
  await assert.rejects(f.devices.request(f.registration.token, 'heartbeat', { command: 'anything' }), isError('INVALID_BODY'));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM res_desktop_events').get().n, 0);
});

await test('terminal task update, inbox and report outbox roll back together on persistence failure', async () => {
  const f = await paired(), task = f.add(); const { job } = await f.devices.request(f.registration.token, 'claim', {});
  f.injectReportFailure(true);
  await assert.rejects(f.devices.request(f.registration.token, 'events', done(job)), /synthetic disk failure/);
  assert.equal(f.tasks.get(task.id).status, 'working');
  assert.equal(f.db.prepare('SELECT state FROM res_desktop_jobs WHERE job_id = ?').get(task.id).state, 'claimed');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM res_desktop_events').get().n, 0);
  assert.deepEqual(f.devices.pendingReports(), []);
  f.injectReportFailure(false);
  await f.devices.request(f.registration.token, 'events', done(job));
  const restarted = new device.DesktopDeviceStore(f.sql, f.tasks, f.atomic);
  assert.deepEqual(restarted.pendingReports(), [task.id]);
  for (let n = 0; n < 205; n++) f.tasks.add({ title: 'New cloud fixture', job: 'No execution', execution: 'local' });
  f.tasks.prune(); assert.ok(f.tasks.get(task.id), 'Undelivered terminal reports survive history pruning');
  restarted.reportDelivered(task.id);
  assert.deepEqual(restarted.pendingReports(), []);
  f.tasks.prune(); assert.equal(f.tasks.get(task.id), null, 'Delivered completed history can be pruned');
});

await test('follow-up keeps device and session hint; thread card exposes latest actual job id only', async () => {
  const f = await paired(), first = f.add(); const { job } = await f.devices.request(f.registration.token, 'claim', {});
  assert.throws(() => f.add({ follows: first.id }), isError('THREAD_BUSY'));
  await f.devices.request(f.registration.token, 'events', done(job, { sessionId: 'native_session_1' }));
  const second = f.add({ follows: first.id }); const receipt = await f.devices.request(f.registration.token, 'claim', {});
  assert.equal(receipt.job.thread, first.root); assert.equal(receipt.job.sessionId, 'native_session_1');
  assert.equal(f.tasks.threads().find(card => card.id === first.root).desktopJobId, second.id);
  const card = f.tasks.card(f.tasks.get(first.id));
  assert.equal(card.deviceId, f.registration.deviceId); assert.equal(card.desktopSessionId, 'native_session_1');
  assert.ok(!('job' in card)); assert.ok(!('code' in card));
  f.devices.revoke({ deviceId: f.registration.deviceId });
  await f.devices.register({ label: 'Replacement device' });
  assert.throws(() => f.add({ follows: second.id }), isError('DEVICE_CHANGED'));
});

await test('queued expiry does not run a task, queue bounded, and uncertain jobs survive pruning', async () => {
  const f = await paired(); const oldest = f.add();
  for (let n = 1; n < 16; n++) f.add();
  assert.throws(() => f.add(), isError('QUEUE_FULL', 429));
  // Old desktop records are retained even as the ordinary history limit is exceeded.
  for (let n = 0; n < 205; n++) f.tasks.add({ title: 'Cloud fixture', job: 'No execution', execution: 'local' });
  f.tasks.prune(); assert.ok(f.tasks.get(oldest.id));
  const original = Date.now;
  try {
    Date.now = () => original() + 25 * 60 * 60_000;
    assert.deepEqual(await f.devices.request(f.registration.token, 'claim', {}), { job: null });
    assert.equal(f.tasks.get(oldest.id).status, 'needs_you');
    assert.match(f.tasks.get(oldest.id).summary, /未执行/);
  } finally { Date.now = original; }
});

await test('a lost claim answer or an uncertain job never holds the device or its thread', async () => {
  const f = await paired(), lost = f.add();
  await f.devices.request(f.registration.token, 'claim', {}); // its answer never reaches the device
  const next = f.add(), original = Date.now;
  try {
    let now = original();
    Date.now = () => now;
    for (let beat = 0; beat < 3; beat++) { now += 2 * 60_000; await f.devices.request(f.registration.token, 'heartbeat', {}); }
    assert.equal(f.db.prepare('SELECT state FROM res_desktop_jobs WHERE job_id = ?').get(lost.id).state, 'unknown', 'heartbeats do not keep an unstarted claim');
    assert.equal(f.devices.quiet(lost.id), 'unknown', 'the quiet check sees it, and the resident tells them once');
    assert.match(cloud.quietNote(f.tasks.get(lost.id), ''), /lost touch with their computer[\s\S]*not run again[\s\S]*DSH session/);
    assert.equal((await f.devices.request(f.registration.token, 'claim', {})).job.id, next.id, 'the next job is still claimed');
    assert.ok(f.add({ follows: lost.id }), 'they can ask to carry on an uncertain thread');
    const never = f.add();
    now += 25 * 60 * 60_000;
    await f.devices.request(f.registration.token, 'heartbeat', {});
    assert.ok(f.add({ follows: never.id }), 'and one that expired without running');
  } finally { Date.now = original; }
});

await test('bounded JSON parser handles binary stream size, content type and malformed objects', async () => {
  const request = (body, headers = {}) => new Request('https://fixture.invalid/desktop/v1/events', { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers }, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) });
  assert.deepEqual(await device.readDesktopJson(request('{}')), {});
  for (const body of ['{', 'null', '[]']) await assert.rejects(device.readDesktopJson(request(body)), error => error.status === 400);
  await assert.rejects(device.readDesktopJson(request('{}', { 'content-type': 'text/plain' })), isError('JSON_REQUIRED', 415));
  await assert.rejects(device.readDesktopJson(request('{}', { 'content-length': String(device.DESKTOP_MAX_BYTES + 1) })), isError('BODY_TOO_LARGE', 413));
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(device.DESKTOP_MAX_BYTES + 1)); controller.close(); } });
  await assert.rejects(device.readDesktopJson(request(stream)), isError('BODY_TOO_LARGE', 413));
});

await test('real Worker routing separates web administration and per-resident device bearer authority', async () => {
  const a = fixture(), b = fixture();
  const agent = f => ({ residentKnown: async id => id === 'other', webDesktop: async () => f.devices.list(),
    webDesktopRegister: input => device.desktopReply(() => f.devices.register(input)),
    webDesktopRevoke: input => device.desktopReply(() => f.devices.revoke(input)),
    desktopDeviceRequest: (token, action, input) => device.desktopReply(() => f.devices.request(token, action, input)) });
  const env = { WEB_KEY: 'synthetic-web-key', RESIDENT: { default: agent(a), other: agent(b) } };
  const request = (path, body, auth = {}) => new Request('https://fixture.invalid' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify(body) });
  const call = req => worker.fetch(req, env, { waitUntil() {} });
  assert.equal((await call(request('/web/desktop/register', { label: 'Fixture' }))).status, 403);
  const registrationResponse = await call(request('/web/desktop/register', { label: 'Fixture' }, { 'x-web-key': env.WEB_KEY }));
  assert.equal(registrationResponse.status, 200); assert.equal(registrationResponse.headers.get('cache-control'), 'no-store');
  const registration = await registrationResponse.json();
  assert.equal((await call(request('/desktop/v1/heartbeat', {}, { 'x-web-key': env.WEB_KEY }))).status, 401);
  assert.equal((await call(request('/desktop/v1/heartbeat', {}, { authorization: 'Bearer ' + registration.token }))).status, 200);
  assert.equal((await call(request('/r/other/desktop/v1/heartbeat', {}, { authorization: 'Bearer ' + registration.token }))).status, 401);
  assert.equal((await call(request('/r/missing/desktop/v1/heartbeat', {}, { authorization: 'Bearer ' + registration.token }))).status, 404);
  const listing = await call(new Request('https://fixture.invalid/web/desktop', { headers: { 'x-web-key': env.WEB_KEY } }));
  assert.ok(!JSON.stringify(await listing.json()).includes(registration.token));
  assert.equal((await call(request('/web/desktop/revoke', { deviceId: registration.deviceId }, { 'x-web-key': env.WEB_KEY }))).status, 200);
  assert.equal((await call(request('/desktop/v1/claim', {}, { authorization: 'Bearer ' + registration.token }))).status, 401);
});
