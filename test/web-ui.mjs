// The page's renderer is plain JS: exercise its real functions without a live account.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync('public/index.html', 'utf8');
const code = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('function resident()'));
const context = vm.createContext({ document: { documentElement: { dataset: { theme: 'dark' } } }, localStorage: { getItem() { return ''; } }, setTimeout, clearTimeout, console, Date, window: {} });
vm.runInContext(code, context);
const page = vm.runInContext('resident()', context);
const line = { id: 'quoted"<>', role: 'assistant', text: '答复<script>unsafe</script>', kind: 'chat', via: 'web', at: null, activity: [
  { type: 'reasoning', text: '<img src=x onerror=unsafe()>' },
  { type: 'tool', id: 'one', name: 'web_fetch', input: '{"url":"https://example.com"}', output: '</pre><script>unsafe()</script>', state: 'output-available' },
  { type: 'tool', id: 'two', name: 'memory_recall', input: '猫', output: '小橘', state: 'output-available' }
] };
const rendered = page.toMessages(line)[0].html;
assert.ok(rendered.includes('想了一下'));
assert.ok(rendered.includes('忙活了 2 回'));
assert.equal((rendered.match(/<details/g) || []).length, 2);
assert.ok(!rendered.includes(' open'));
assert.ok(!rendered.includes('<script>') && !rendered.includes('<img '));
assert.ok(rendered.includes('&lt;script&gt;'));
assert.ok(rendered.includes('quoted&quot;&lt;&gt;'));
console.log('PASS thoughts and tools are collapsed, counted per call, and HTML-escaped');
assert.equal(page.activityHtml({ activity: [] }), '');
assert.ok(page.activityHtml({ ...line, pending: true }).includes('正在想…'));
assert.ok(page.activityHtml({ ...line, pending: true }).includes('还在继续'));
assert.equal(page.toMessages({ ...line, text: '', activity: [line.activity[1]] }).length, 1);
console.log('PASS empty reasoning is not fabricated; running activity and tool-only replies render');
page.miniApp = true;
page.authed = true;
page.miniSession = async () => { throw new Error('请关闭小窗后重新打开'); };
await assert.rejects(page.api('/web/messages'), /重新打开/);
assert.equal(page.authed, false);
assert.match(page.loginError, /重新打开/);
console.log('PASS a failed Mini App renewal visibly returns to the reconnect screen');
assert.ok(!html.includes('<script src="https://telegram.org/'));
assert.ok(html.includes("script.src = 'https://telegram.org/js/telegram-web-app.js'"));
console.log('PASS ordinary WEB_KEY pages do not load Telegram third-party JS');
