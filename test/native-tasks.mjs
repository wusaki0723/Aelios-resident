// Real local Worker/Think facets, fake model only. Start mock-server and a fresh wrangler.test worker.
// Run `node test/native-tasks.mjs first`, restart the Worker with the same state, then run `... restart`.
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:8787';
const mock = 'http://127.0.0.1:9999';
const headers = { 'x-web-key': 'test-web-key', 'content-type': 'application/json' };
async function api(path, body) {
  const response = await fetch(base + path, { headers, method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}
async function set(values) { for (const [key, text] of Object.entries(values)) await api('/web/config', { key, text }); }
async function waitTask(id) {
  const until = Date.now() + 40000;
  while (Date.now() < until) {
    const task = (await api('/web/tasks')).tasks.find(t => t.id === id);
    if (task && ['done', 'failed', 'needs_you'].includes(task.status)) {
      assert.equal(task.status, 'done', JSON.stringify(task));
      return task;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Task ${id} did not finish`);
}
async function say(text) {
  const before = new Set((await api('/web/tasks')).tasks.map(t => t.id));
  await api('/web/say', { text });
  const task = (await api('/web/tasks')).tasks.find(t => !before.has(t.id));
  assert.ok(task, 'message created a task');
  return task;
}
if (process.argv[2] !== 'restart') {
  await set({ CLOUD_TASKS: 'on', CLOUD_TASK_GITHUB_TOKEN: 'good-token' });
  const state = await api('/web/tasks');
  assert.equal(state.mode, 'linux');
  const before = (await (await fetch(mock + '/__log')).json()).filter(e => e.kind === 'github.dispatch').length;
  const task = await say('后台写文件');
  await waitTask(task.id);
  const after = (await (await fetch(mock + '/__log')).json()).filter(e => e.kind === 'github.dispatch').length;
  assert.equal(after, before, 'local job stays local despite a configured Actions executor');
  const messages = (await api('/web/messages')).data;
  assert.ok(!JSON.stringify(messages).includes('native-workspace-persisted'), 'workspace tool content stays out of main chat');
  const thread = await api(`/web/thread?id=${task.id}`);
  assert.deepEqual(thread.files.map(f => f.path), ['/draft.txt']);
  const file = await fetch(`${base}/web/thread/file?id=${task.id}&path=${encodeURIComponent('/draft.txt')}`, { headers });
  assert.equal(await file.text(), 'native-workspace-persisted');
  assert.deepEqual(thread.lines.find(l => l.role === 'result').files.map(f => f.path), ['/draft.txt'], 'the report shows the file its task made');
  console.log('PASS native child writes a workspace file without dispatching Actions or leaking tool history; the web page lists and serves it');
  const linux = await say('Linux派活');
  assert.ok(linux.sessionUrl.includes('github.com/octo/resident-hands/actions/'));
  const dispatched = (await (await fetch(mock + '/__log')).json()).filter(e => e.kind === 'github.dispatch');
  assert.equal(dispatched.length, before + 1);
  console.log('PASS explicit Linux work goes to the repository the resident set up');

  // What the run makes comes back here (hands.mjs, save_artifacts): kept with the thread's files, shown on its report.
  const [, hid, hcode] = dispatched.at(-1).body.inputs.job.match(/^task: (t_[0-9a-f]{10})\ncode: ([0-9a-f]{32})\n/);
  const hand = (path, body, code = hcode) => fetch(`${base}/tasks/${hid}/files?path=${encodeURIComponent(path)}`, { method: 'POST', headers: { 'x-task-code': code }, body });
  assert.equal((await hand('out/zhilai.html', '<h1>知来</h1>', '0'.repeat(32))).status, 403);
  for (const bad of ['../x.html', '.env', 'out/.git/config', '/etc/passwd', 'node_modules/a.js', '']) assert.equal((await hand(bad, 'x')).status, 400, bad);
  assert.equal((await hand('out/zhilai.html', '')).status, 400, 'an empty file');
  assert.equal((await hand('out/big.bin', new Uint8Array(10 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await hand('out/zhilai.html', '<h1>知来</h1>')).status, 200);
  assert.equal((await hand('zhilai.svg', '<svg/>')).status, 200);
  const result = await fetch(`${base}/tasks/${hid}/result`, { method: 'POST', headers: { 'x-task-code': hcode, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done', summary: '做好了' }) });
  assert.equal(result.status, 200);
  assert.equal((await hand('later.html', 'x')).status, 409, 'not after the task is done');
  const ran = await api(`/web/thread?id=${hid}`);
  assert.deepEqual(ran.files.map(f => f.path).sort(), ['/out/zhilai.html', '/zhilai.svg']);
  assert.deepEqual(ran.lines.find(l => l.role === 'result').files.map(f => f.path).sort(), ['/out/zhilai.html', '/zhilai.svg']);
  assert.equal(ran.canSay, false, 'still not one to write to here');
  const page = await fetch(`${base}/web/thread/file?id=${hid}&path=${encodeURIComponent('/out/zhilai.html')}`, { headers });
  assert.equal(await page.text(), '<h1>知来</h1>');
  console.log('PASS a run on GitHub Actions hands its files back: kept with the thread, shown on its report, opened from the web page');

  // cloud_task is the same whatever is set up; a job that needs a shell is not sent when no place has one.
  await set({ CLOUD_TASK_GITHUB_TOKEN: '' });
  const count = (await api('/web/tasks')).tasks.length;
  await api('/web/say', { text: 'Linux派活' });
  assert.equal((await api('/web/tasks')).tasks.length, count, 'nothing with a shell is set up: nothing is sent');
  await set({ CLOUD_TASK_GITHUB_TOKEN: 'good-token' });
  console.log('PASS a job asked for a place with a shell is not sent when GitHub Actions is not set up');
} else {
  const tasks = (await api('/web/tasks')).tasks;
  const first = tasks.find(t => t.title === '工作区写入测试' && t.status === 'done');
  assert.ok(first, 'first-stage task persisted across Worker restart');
  const follow = await say(`后台接着读 ${first.id}`);
  const result = await waitTask(follow.id);
  assert.ok(result.summary.includes('native-workspace-persisted'), JSON.stringify(result));
  assert.equal(follow.thread, first.id, 'a follow-up belongs to the first task\'s thread');
  const thread = await api(`/web/thread?id=${first.id}`);
  assert.deepEqual(thread.lines.filter(l => l.role === 'user').map(l => l.task), [first.id, follow.id]);
  console.log('PASS local follow-up reads the same native workspace after Worker restart, in the same thread');
}
