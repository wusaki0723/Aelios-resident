// Real local Worker + SQLite Durable Objects + FAKE_MODEL; no native helper/model execution.
// TEST_BASE_URL=http://127.0.0.1:18787 node test/desktop-worker.mjs
// Reuse an isolated wrangler.test.jsonc Worker and mock server; this file owns neither process.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = new URL(process.env.TEST_BASE_URL || 'http://127.0.0.1:8787');
assert.ok(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Only an isolated local HTTP Worker is supported');
assert.ok(!base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 'Use a bare local Worker origin');
const WEB_KEY = 'test-web-key'; // Public synthetic test key from wrangler.test.jsonc.
const protocol = 'resident-dsh/1';
const run = randomUUID().replaceAll('-', '').slice(0, 12);
const other = `desk-${run}`;
const deadline = Date.now() + 58_000;
const pairings = [];
const prefix = resident => resident === 'default' ? '' : `/r/${resident}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, Math.max(0, deadline - Date.now()))));

async function request(path, { body, token, web = false, status = 200, code } = {}) {
  const remaining = deadline - Date.now();
  assert.ok(remaining > 0, `Local desktop integration deadline exceeded before ${path}`);
  const response = await fetch(base.origin + path, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    headers: { ...(web ? { 'x-web-key': WEB_KEY } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(Math.min(10_000, remaining))
  });
  assert.equal(response.status, status, `Unexpected status from local ${path}`);
  let data; try { data = await response.json(); } catch { throw new Error(`Local ${path} returned invalid JSON`); }
  if (code) assert.equal(data.code, code, `Unexpected machine code from ${path}`);
  if (status === 200) assert.ok(!data.error, `Local ${path} returned an application error`);
  return { data, headers: response.headers };
}
const web = async (resident, path, body) => (await request(prefix(resident) + '/web/' + path, { web: true, body })).data;
const device = async (resident, pairing, action, body = {}, expected = {}) => (await request(prefix(resident) + '/desktop/v1/' + action, { token: pairing.token, body, ...expected })).data;
async function poll(label, read, accept, budget = 12_000) {
  const until = Math.min(deadline, Date.now() + budget);
  do { const value = await read(); if (accept(value)) return value; await pause(250); } while (Date.now() < until);
  throw new Error(`Timed out waiting for local ${label}`);
}
const matchingReports = (data, summary) => data.data.filter(line => line.role === 'assistant' && line.via === 'task' && line.text.includes(summary));
async function register(resident) {
  const { data, headers } = await request(prefix(resident) + '/web/desktop/register', { web: true, body: { label: `Synthetic desktop ${run}` } });
  assert.equal(data.protocol, protocol);
  assert.ok(typeof data.deviceId === 'string' && /^dev_[a-f0-9]{24}$/.test(data.deviceId), 'Device id has expected opaque shape');
  assert.ok(typeof data.token === 'string' && /^rd_[a-f0-9]{64}$/.test(data.token), 'Device credential has expected shape');
  assert.equal(headers.get('cache-control'), 'no-store');
  pairings.push({ resident, ...data, revoked: false });
  return pairings.at(-1);
}
async function dispatch(resident) {
  const before = new Set((await web(resident, 'tasks')).tasks.map(task => task.id));
  const response = await web(resident, 'say', { text: '桌面只读派活' });
  assert.equal(response.status, 'completed', 'Synthetic main resident completes desktop tool call');
  const tasks = await poll('desktop cloud_task card', () => web(resident, 'tasks'), value => value.tasks.some(task => !before.has(task.id) && task.runs === 'desktop'));
  const task = tasks.tasks.find(task => !before.has(task.id) && task.runs === 'desktop');
  assert.equal(task.title, '本机只读联调');
  assert.ok(!('job' in task) && !('code' in task), 'Task cards exclude instruction and task-report credential');
  return task;
}
async function finish(resident, pairing, job, sessionId, summary) {
  const started = { eventId: `test:${run}:${job.id}:started`, jobId: job.id, leaseId: job.leaseId, type: 'started', sessionId };
  assert.equal((await device(resident, pairing, 'events', started)).ok, true);
  const completed = { eventId: `test:${run}:${job.id}:completed`, jobId: job.id, leaseId: job.leaseId, type: 'completed', summary, sessionId };
  assert.equal((await device(resident, pairing, 'events', completed)).ok, true);
  const duplicate = await device(resident, pairing, 'events', completed);
  assert.ok(duplicate.ok && duplicate.duplicate === true, 'Identical terminal event is durably deduplicated');
  return completed;
}

let configured = false;
try {
  assert.equal((await web('default', 'check')).ok, true);
  const preflight = await web('default', 'desktop');
  assert.ok(preflight.devices.every(device => device.revokedAt !== null), 'Use an isolated test Worker with no active pre-existing default device');
  await web('default', 'config', { key: 'CLOUD_TASKS', text: 'off' }); configured = true;
  await web('default', 'residents', { id: other, name: 'Desktop HTTP fixture' });
  const a = await register('default'), b = await register(other);
  assert.ok(a.token !== b.token, 'Residents receive separate credentials');
  assert.equal((await web('default', 'tasks')).on, false, 'Registration alone never enables cloud tasks');
  await device('default', a, 'claim', {}, { status: 409, code: 'TASKS_DISABLED' });
  await request('/web/desktop/register', { web: true, body: { label: 'Second synthetic device' }, status: 409, code: 'DEVICE_EXISTS' });
  await request('/desktop/v1/heartbeat', { web: true, body: {}, status: 401, code: 'UNAUTHORIZED' });
  await request('/web/desktop', { token: a.token, status: 403 });
  await device('default', { token: 'rd_' + '0'.repeat(64) }, 'heartbeat', {}, { status: 401, code: 'UNAUTHORIZED' });
  await device(other, a, 'heartbeat', {}, { status: 401, code: 'UNAUTHORIZED' });
  await device('default', b, 'heartbeat', {}, { status: 401, code: 'UNAUTHORIZED' });
  for (const resident of ['default', other]) await web(resident, 'config', { key: 'CLOUD_TASKS', text: 'on' });

  const first = await dispatch('default');
  const beat = await device('default', a, 'heartbeat'); assert.ok(beat.ok && beat.protocol === protocol);
  const { job } = await device('default', a, 'claim');
  assert.ok(job && job.id === first.id && job.thread === first.thread && job.protocol === protocol);
  assert.equal(job.attempt, 1); assert.ok(/^lease_[a-f0-9]{32}$/.test(job.leaseId));
  assert.ok(typeof job.instruction === 'string' && job.instruction.includes('不写入'), 'Claim carries scripted read-only instruction');
  assert.equal((await device('default', a, 'claim')).job, null, 'Claimed task is never issued twice');
  await device(other, b, 'events', { eventId: `test:${run}:cross`, jobId: job.id, leaseId: job.leaseId, type: 'completed', summary: 'Cross resident must fail' }, { status: 409, code: 'INVALID_LEASE' });
  const sessionId = `session_synthetic_${run}`;
  const summary = `desktop-first-result-${run}`;
  const completion = await finish('default', a, job, sessionId, summary);
  const card = (await web('default', 'tasks')).tasks.find(task => task.id === job.id);
  assert.ok(card.status === 'done' && card.deviceId === a.deviceId && card.desktopSessionId === sessionId);
  let history = await poll('one main-conversation report', () => web('default', 'messages'), value => matchingReports(value, summary).length === 1);
  assert.equal(matchingReports(history, summary).length, 1);
  assert.ok(!(await web(other, 'messages')).data.some(line => line.text.includes(summary)), 'Other resident never sees default report');
  assert.ok(!(await web(other, 'tasks')).tasks.some(task => task.id === first.id), 'Other resident never sees default task');

  // Exercise a real follow-up so the latest job differs from the root thread identifier.
  assert.equal((await web('default', 'say', { text: '接着派' })).status, 'completed');
  const nextTasks = await poll('desktop follow-up', () => web('default', 'tasks'), value => value.tasks.some(task => task.runs === 'desktop' && task.id !== first.id && task.thread === first.thread));
  const nextCard = nextTasks.tasks.find(task => task.runs === 'desktop' && task.id !== first.id && task.thread === first.thread);
  const next = (await device('default', a, 'claim')).job;
  assert.ok(next && next.id === nextCard.id && next.thread === first.thread && next.id !== next.thread);
  assert.equal(next.sessionId, sessionId, 'Follow-up receives the previous opaque native-session hint');
  const latest = (await web('default', 'threads')).threads.find(thread => thread.id === first.thread);
  assert.ok(latest.desktopJobId === next.id && latest.deviceId === a.deviceId, 'Thread summary identifies the latest actual desktop job');
  await finish('default', a, next, sessionId, `desktop-followup-result-${run}`);

  const isolated = await dispatch(other), otherClaim = (await device(other, b, 'claim')).job;
  assert.ok(otherClaim && otherClaim.id === isolated.id && otherClaim.id !== first.id);
  await finish(other, b, otherClaim, `session_other_${run}`, `desktop-other-result-${run}`);
  assert.ok(!(await web('default', 'tasks')).tasks.some(task => task.id === isolated.id), 'Default task list excludes other resident job');
  await device('default', a, 'events', completion); // Retry after its first report has already appeared.
  await device('default', a, 'heartbeat');
  await pause(1500);
  history = await web('default', 'messages');
  assert.equal(matchingReports(history, summary).length, 1, 'Terminal replay never creates a second main report');
  const listings = [await web('default', 'desktop'), await web(other, 'desktop')];
  for (const listing of listings) assert.ok(!JSON.stringify(listing).includes(a.token) && !JSON.stringify(listing).includes(b.token), 'Metadata never exposes device credentials');
  for (const pairing of pairings) {
    assert.equal((await web(pairing.resident, 'desktop/revoke', { deviceId: pairing.deviceId })).ok, true); pairing.revoked = true;
    await device(pairing.resident, pairing, 'heartbeat', {}, { status: 401, code: 'UNAUTHORIZED' });
  }
  console.log('PASS: real local Worker/DO desktop task dispatch, scoped credentials, claim-once, event dedup, native-session hints, latest thread job, one main report, resident isolation and revocation.');
} finally {
  // Only credentials created by this run are revoked; synthetic residents/history remain for inspection.
  for (const pairing of pairings.filter(value => !value.revoked)) {
    try { await web(pairing.resident, 'desktop/revoke', { deviceId: pairing.deviceId }); } catch {}
  }
  if (configured) { try { await web('default', 'config', { key: 'CLOUD_TASKS', text: 'off' }); } catch {} }
}
