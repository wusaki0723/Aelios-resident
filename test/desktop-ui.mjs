// Pure bridge contracts and explicitly named source checks; no DOM/React emulation.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
await import('../public/desktop.js');
const ui = globalThis.ResidentDesktopUI;
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const bridge = (request = async () => ({ accepted: true }), origin = 'https://resident.example') => ({ protocol: 'resident-dsh/1', request, origin });

test('desktop activation requires the exact protocol and a callable request capability', () => {
  for (const value of [undefined, null, {}, { protocol: 'resident-dsh/2', request() {} }, { protocol: 'resident-dsh/1' }]) assert.equal(ui.enabled(value), false);
  assert.equal(ui.enabled(bridge()), true);
});

test('configured site origin handles opaque containers without accepting credential-bearing or unsafe origins', () => {
  assert.equal(ui.origin(null, 'https://ordinary.example'), 'https://ordinary.example');
  assert.equal(ui.origin(bridge(), 'null'), 'https://resident.example');
  assert.equal(ui.origin(bridge(undefined, 'http://127.0.0.1:8787'), 'null'), 'http://127.0.0.1:8787');
  for (const origin of ['http://resident.example', 'https://key@resident.example', 'https://resident.example/path', 'https://resident.example/?key=secret', 'javascript:alert(1)', 'https://resident.example/#key']) assert.throws(() => ui.origin(bridge(undefined, origin), 'null'));
});

test('helper navigation sends a job reference, never cloud-supplied session IDs, commands or paths', async () => {
  const calls = [];
  const native = bridge(async (...args) => { calls.push(args); return { accepted: true }; });
  assert.deepEqual(await ui.open(native, 'default', { id: 'job_1', runs: 'desktop', desktopSessionId: 'untrusted-session', cwd: '/private', command: 'something' }), { accepted: true });
  assert.deepEqual(calls, [['helper.open', { resident: 'default', jobId: 'job_1' }]]);
  assert.deepEqual(ui.openPayload('second', { id: 'thread_1', desktopJobId: 'job_2', runs: 'desktop' }), { resident: 'second', jobId: 'job_2' });
});

test('wrong resident identifiers, non-desktop jobs and invalid job references are rejected before dispatch', async () => {
  let calls = 0;
  const native = bridge(async () => { calls++; });
  for (const [resident, task] of [['../other', { id: 'job_1', runs: 'desktop' }], ['default', { id: 'job_1', runs: 'local' }], ['default', { id: '../session', runs: 'desktop' }], ['default', { desktopSessionId: 'session_1', runs: 'desktop' }], ['default', { id: 'x'.repeat(161), runs: 'desktop' }]]) await assert.rejects(ui.open(native, resident, task));
  assert.equal(calls, 0);
});

test('ordinary website helper action explains the original-device boundary without creating a session', async () => {
  await assert.rejects(ui.open(null, 'default', { id: 'job_1', runs: 'desktop' }), /请在原设备的 DSH/);
});

test('source contract: desktop startup waits for readiness and key storage is bypassed', () => {
  assert.match(app, /function readKey\(\) \{ if \(desktop\) return 'desktop';/);
  assert.match(app, /function writeKey\(value\) \{ if \(desktop\) return;/);
  assert.ok(app.indexOf('await desktop.ready') < app.indexOf("fetch('/models.json')"));
  assert.match(app, /if \(!desktop\) try \{ history\.replaceState/);
  assert.match(app, /else history\.replaceState\(null, '', '\/'\)/);
  assert.match(app, /return this\.siteOrigin\(\) \+ this\.residentPrefix\(\) \+ '\/messengers\/wecom\/webhook'/);
});

test('source contract: every push setup/load/action and SW listener is disabled in desktop mode', () => {
  assert.match(app, /preparePush\(\) \{\s+if \(desktop\)/);
  assert.match(app, /async loadPushState\(\) \{\s+if \(desktop \|\| this\.miniApp\) return;/);
  for (const method of ['enablePush', 'disablePush', 'testPush']) assert.match(app, new RegExp('async ' + method + '\\(\\) \\{\\s+if \\(desktop\\)'));
  assert.match(app, /if \(!desktop && 'serviceWorker' in navigator\)/);
});

test('source contract: original cards navigate by explicit click; desktop jobs bypass cloud thread navigation', () => {
  assert.ok(html.indexOf('src="/desktop.js"') < html.indexOf('src="/app.js"'));
  assert.match(html, /@click="openDesktopTask\(task\)"/);
  assert.match(html, /查看 DSH 执行过程/);
  assert.match(html, /x-show="!task\.test && task\.runs !== 'desktop'"/);
  assert.equal((html.match(/@click="openTaskThread\(item\)"/g) || []).length, 2);
  assert.match(app, /task\.runs === 'desktop' \? this\.openDesktopTask\(task\) : this\.openThread\(task\.id\)/);
  assert.equal((app.match(/desktopUI\.open\(/g) || []).length, 1);
  assert.match(html, /role="alert" x-show="desktopError"/);
});

test('source contract: drafts are restored per resident and saved before leaving for the helper', () => {
  assert.match(app, /restored\.resident === this\.resident && typeof restored\.draft === 'string'/);
  assert.match(app, /this\.\$watch\('draft'/);
  assert.match(app, /if \(!desktopDraftReady\) return;/);
  assert.match(app, /await desktop\.request\('draft\.save', \{ resident: on, text: String\(this\.draft \|\| ''\)\.slice\(0, 16000\) \}\);\s+await desktopUI\.open/);
  assert.doesNotMatch(app, /desktop\.request\('(?:helper\.request|helper\.create|shell|execute)'/);
});
