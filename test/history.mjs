import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'resident-history-'));
await build({ entryPoints: ['src/web/history.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'history.mjs') });
const { activityOf, WebDraft, detail } = await import(pathToFileURL(join(dir, 'history.mjs')));
rmSync(dir, { recursive: true, force: true });
let count = 0;
function test(name, run) { run(); count++; console.log('PASS ' + name); }
test('reasoning has text only, never signed provider metadata', () => {
  assert.deepEqual(activityOf([{ type: 'reasoning', text: '想一想', providerMetadata: { signature: 'hidden' } }]), [{ type: 'reasoning', text: '想一想' }]);
  assert.deepEqual(activityOf([{ type: 'reasoning', text: '' }, { type: 'text', text: 'hi' }]), []);
});
test('one call with its result counts once, repeated calls count separately', () => {
  const parts = [
    { type: 'tool-web_fetch', toolCallId: 'a', input: { url: 'https://example.com' } },
    { type: 'tool-web_fetch', toolCallId: 'a', input: { url: 'https://example.com' }, output: '<script>unsafe</script>', state: 'output-available' },
    { type: 'dynamic-tool', toolCallId: 'b', toolName: 'web_fetch', input: { url: 'https://example.com' }, state: 'output-error', errorText: 'failed' }
  ];
  const calls = activityOf(parts);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].output, '<script>unsafe</script>');
  assert.equal(calls[1].output, 'failed');
});
test('structured credentials are redacted and details are bounded', () => {
  assert.ok(!detail({ key: { api_key: 'hidden', Authorization: 'hidden', signature: 'hidden' }, good: 'yes' }).includes('hidden'));
  assert.ok(detail('x'.repeat(20000)).length < 16100);
});
test('stream combines deltas, updates tools and preserves order', () => {
  const draft = new WebDraft('live_test', 1, 'web');
  draft.chunk({ type: 'reasoning-delta', id: 'r', text: '先' });
  draft.chunk({ type: 'reasoning-delta', id: 'r', text: '想想' });
  draft.chunk({ type: 'tool-call', toolCallId: 'a', toolName: 'memory_recall', input: { query: '猫' } });
  draft.chunk({ type: 'tool-result', toolCallId: 'a', toolName: 'memory_recall', output: '小橘' });
  draft.chunk({ type: 'text-delta', id: 't', text: '找到' });
  draft.chunk({ type: 'text-delta', id: 't', text: '了' });
  assert.equal(draft.parts.length, 3);
  assert.equal(draft.parts[2].text, '找到了');
  const activity = activityOf(draft.parts);
  assert.equal(activity.length, 2);
  assert.equal(activity[0].text, '先想想');
  assert.equal(activity[1].state, 'output-available');
  assert.equal(activity[1].output, '小橘');
});
console.log(`${count} history tests passed`);
