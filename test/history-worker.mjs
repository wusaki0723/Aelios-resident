// Requires the local fake worker (wrangler.test.jsonc) and mock-server on :9999.
import assert from 'node:assert/strict';
const base = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const headers = { 'x-web-key': 'test-web-key', 'content-type': 'application/json' };
async function api(path, body) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.status, 200);
  return response.json();
}
const original = (await api('/web/model')).model;
try {
  await api('/web/model', { text: 'fake' });
  // Inspect while the request is still pending, then ensure its temporary id/state is gone.
  const request = api('/web/say', { text: '思考流测试' });
  await new Promise(resolve => setTimeout(resolve, 750));
  const live = (await api('/web/messages')).data.at(-1);
  assert.equal(live.pending, true);
  assert.equal(live.activity[0].text, '先想想这一句。');
  assert.equal(live.text, '');
  assert.equal((await request).status, 'completed');
  const done = (await api('/web/messages')).data.at(-1);
  assert.ok(!done.pending);
  assert.equal(done.text, '想好啦。');
  assert.equal(done.activity[0].text, '先想想这一句。');
  assert.ok(!JSON.stringify(done).includes('signature'));
  console.log('PASS live reasoning is visible before the answer and remains in history after completion');
  await api('/web/say', { text: '帮我查记忆' });
  const tools = (await api('/web/messages')).data.at(-1).activity.filter(a => a.type === 'tool');
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'memory_recall');
  assert.equal(tools[0].state, 'output-available');
  assert.ok(tools[0].output.includes('mem-birthday'));
  assert.equal((await api('/web/messages')).data.filter(line => line.pending).length, 0);
  console.log('PASS a tool call and result count once; no stale draft overrides the next reply');
} finally {
  await api('/web/model', { text: original });
}
