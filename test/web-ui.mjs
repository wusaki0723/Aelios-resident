// The page's renderer is plain JS: exercise its real functions without a live account.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync('public/index.html', 'utf8');
const code = readFileSync('public/app.js', 'utf8');
const markdown = readFileSync('public/markdown.js', 'utf8');
// The parts app.js mixes into the page's state, as the page loads them.
const mixins = { groupPage: 'public/group.js', machinePage: 'public/machine.js', waitingPage: 'public/waiting.js' };
assert.ok(html.includes('<script src="/app.js"></script>'), 'the page loads its script from /app.js');
for (const file of Object.values(mixins)) assert.ok(html.includes(`<script src="/${file.slice('public/'.length)}"></script>`), `the page loads ${file}`);
const resized = [];
const context = vm.createContext({ document: { documentElement: { dataset: { theme: 'dark' } } }, localStorage: { getItem() { return ''; }, setItem() {}, removeItem() {} }, setTimeout, clearTimeout, console, Date, URL, Blob, TextDecoder, TextEncoder, atob, btoa, confirm: () => true, window: {}, ResizeObserver: class { constructor(fn) { resized.push(fn); } observe() {} } });
vm.runInContext(markdown, context);
vm.runInContext(code, context);
// A mixed-in part must not reuse a name the page already has: Object.assign would replace it (waiting.js once
// replaced app.js's waiting(), and the chat stopped drawing).
const own = new Set(Object.keys(vm.runInContext('resident()', context)));
const named = new Map();
for (const [factory, file] of Object.entries(mixins)) {
  vm.runInContext(readFileSync(file, 'utf8'), context);
  for (const key of Object.keys(vm.runInContext(`${factory}()`, context))) {
    assert.ok(!own.has(key), `${file} replaces app.js's ${key}`);
    assert.ok(!named.has(key), `${file} and ${named.get(key)} both name ${key}`);
    named.set(key, file);
  }
}
// What Alpine would add to the page's state.
vm.runInContext('function testPage() { var p = resident(); p.$nextTick = function (fn) { fn(); }; p.$refs = {}; return p; }', context);
const page = vm.runInContext('testPage()', context);
const copy = (value) => JSON.parse(JSON.stringify(value));
// Nothing the model or anyone else wrote is put into the page as HTML: every message, card and tool call is bound with x-text.
assert.ok(!html.includes('x-html'), 'the page never binds HTML');
// Buttons that do something show a small icon, not a word: each says what it does in title and aria-label.
assert.ok(!/">(保存|存上|删掉|拿掉|下载|关掉|清掉|改时间|打开线程|打开会话|试一下|断开|复制|复制提示词|不用了|取消|算了|好|建好|搜|更早的|再往前看|删掉这个群)<\/(button|a)>/.test(html), 'no word buttons for actions');
for (const button of html.match(/<(button|a) class="icon-btn[^>]*>/g)) assert.ok(/ :?aria-label="/.test(button) && / :?title="/.test(button), button);
assert.ok(readFileSync('public/app.css', 'utf8').includes('.i-trash { --i: url("data:image/svg+xml,'), 'icons are masks in the stylesheet');
assert.ok(!code.includes('innerHTML') && !markdown.includes('innerHTML') && !markdown.includes('insertAdjacentHTML') && !markdown.includes('outerHTML'), 'the scripts never write HTML');
assert.ok(html.indexOf('<script src="/markdown.js"></script>') < html.indexOf('<script src="/app.js"></script>') && html.indexOf('<script src="/app.js"></script>') < html.indexOf('alpine-3.14.9.min.js'), 'x-markdown is there before Alpine starts');
const line = { id: 'quoted"<>', role: 'assistant', text: '答复<script>unsafe</script>', kind: 'chat', via: 'web', at: null, activity: [
  { type: 'reasoning', text: '<img src=x onerror=unsafe()>' },
  { type: 'tool', id: 'one', name: 'web_fetch', input: '{"url":"https://example.com"}', output: '# Example Domain\n</pre><script>unsafe()</script>', state: 'output-available' },
  { type: 'tool', id: 'two', name: 'memory_recall', input: '{"query":"猫"}', output: '小橘', state: 'output-available' }
] };
const busy = page.busyOf(line);
assert.equal(busy.label, '想了一下 · 忙活了 2 回');
assert.equal(busy.live, false);
assert.deepEqual(copy(busy.items.map((item) => [item.what, item.detail, item.state])), [['想了一下', '<img src=x onerror=unsafe()>', ''], ['读了网页', 'https://example.com', ''], ['翻了记忆', '猫', '']]);
assert.deepEqual(copy(busy.items[1].body), [{ label: '参数', text: '{"url":"https://example.com"}' }, { label: '结果', text: '# Example Domain\n</pre><script>unsafe()</script>' }], 'the full arguments and result are kept, to be shown as text');
assert.deepEqual(copy(page.openBusy), {}, 'folded until tapped');
page.toggleBusy(line.id);
assert.equal(page.openBusy[line.id], true);
page.toggleBusy(line.id);
assert.equal(page.openBusy[line.id], false);
assert.deepEqual(copy(page.bubblesOf(line)), [{ text: '答复<script>unsafe</script>', first: true, last: true }]);
assert.equal(page.bubblesOf({ ...line, text: '一\n\n二' }).length, 2, 'a blank line starts a new bubble, as on Telegram');
const markup = html.slice(html.indexOf('<template x-for="row in rows()"'), html.indexOf('<footer class="compose"'));
for (const binding of ['x-markdown="b.text"', 'x-text="busyOf(row.line).label"', 'x-text="item.what"', 'x-text="item.detail"', 'x-text="part.text"', 'x-text="p.title"', 'x-text="task.title"', 'x-text="taskPreview(task)"', 'x-text="row.line.text"']) {
  assert.ok(markup.includes(binding), binding + ' is bound as text');
}
console.log('PASS thoughts and tools fold into one line under the reply, counted per call, kept whole and bound as text');
assert.equal(page.busyOf({ activity: [] }), null);
assert.equal(page.busyOf({ ...line, activity: [line.activity[0]], pending: true }).label, '正在想…');
assert.equal(page.busyOf({ ...line, pending: true }).label, '想了一下 · 忙活了 2 回 · 还在继续');
assert.equal(page.busyOf({ ...line, pending: true }).live, true);
assert.equal(page.busyOf({ ...line, activity: [{ type: 'reasoning', text: '' }] }), null, 'empty reasoning is not made up');
assert.equal(page.busyOf({ ...line, activity: [{ type: 'tool', id: 'x', name: 'mcp_notion_search', input: '', state: 'input-available' }] }).items[0].what, '用了工具 notion_search');
assert.equal(page.busyOf({ ...line, activity: [{ type: 'tool', id: 'x', name: 'web_search', input: '{}', state: 'output-error', output: 'no' }] }).items[0].state, '出错了');
const toolOnly = { ...line, text: '', activity: [line.activity[1]] };
assert.equal(page.bubblesOf(toolOnly).length, 0);
assert.ok(page.busyOf(toolOnly), 'a tool-only reply still shows what it did');
console.log('PASS empty reasoning is not fabricated; running activity and tool-only replies render');
// The pages it read become cards, http(s) only, once each.
const pages = page.pagesOf({ activity: [
  line.activity[1],
  { ...line.activity[1], id: 'again' },
  { type: 'tool', id: 'bad', name: 'web_fetch', input: '{"url":"javascript:unsafe()"}', output: '', state: 'output-available' },
  { type: 'tool', id: 'failed', name: 'web_fetch', input: '{"url":"https://failed.example"}', output: 'nope', state: 'output-error' }
] });
assert.deepEqual(copy(pages), [{ url: 'https://example.com', host: 'example.com', title: 'Example Domain' }]);
console.log('PASS pages it read are cards with their heading, http(s) only and once each');
// The conversation as rows: a day line, a line above what it wrote unasked, notices, the letter, and the dots while it thinks.
const day = Date.UTC(2026, 9, 25, 4);
page.lines = [
  { id: 'u1', role: 'user', text: '早', kind: 'chat', via: 'web', at: day },
  { id: 'a1', role: 'assistant', text: '早呀', kind: 'chat', via: 'web', at: day + 1000 },
  { id: 'n1', role: 'system', text: '换成了 gpt-5', kind: 'notice', at: day + 2000 },
  { id: 'a2', role: 'assistant', text: '想你了', kind: 'chat', via: 'checkin', at: day + 3000 },
  { id: 'a3', role: 'assistant', text: '还有一句', kind: 'chat', via: 'checkin', at: day + 4000 },
  { id: 'l1', role: 'system', text: '信', kind: 'letter', at: day + 86400000 }
];
assert.deepEqual(copy(page.rows().map((row) => row.type)), ['day', 'line', 'line', 'notice', 'why', 'line', 'line', 'day', 'letter'], 'one line above two messages it wrote unasked');
assert.match(page.rows().find((row) => row.type === 'why').text, /^主动找你 · /);
page.lines = [{ id: 'u1', role: 'user', text: '在吗', kind: 'chat', via: 'web', at: null }];
page.sending = 1;
assert.equal(page.rows().at(-1).type, 'typing', 'dots until the reply starts');
page.lines.push({ id: 'a1', role: 'assistant', text: '在', kind: 'chat', via: 'web', at: null, pending: true });
assert.ok(!page.rows().some((row) => row.type === 'typing'), 'no dots once the reply shows');
page.sending = 0;
page.lines = [];
console.log('PASS the conversation becomes rows: days, notices, letters, one line above what it wrote unasked, dots while waiting');
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
assert.deepEqual(copy(page.stickersOf({ stickers: [{ url: '/stickers/0123456789abcdef01234567', video: false }, { url: 'https://evil.example/x.gif', video: false }, { url: '/stickers/../web/key', video: false }] })), [{ url: '/stickers/0123456789abcdef01234567', video: false }]);
assert.ok(markup.includes('<video :src="s.url" autoplay loop muted playsinline'));
console.log('PASS stickers show only from the resident itself');
const voiceFields = (provider, model = '') => [
  { key: 'VOICE_PROVIDER', kind: 'choice', value: provider, fromWorker: '', choices: ['off', 'elevenlabs', 'cartesia', 'openrouter'] },
  { key: 'VOICE_MODEL', kind: 'text', value: model, fromWorker: '' },
  { key: 'VOICE_ID', kind: 'text', value: '', fromWorker: '' },
  { key: 'VOICE_REPLY', kind: 'choice', value: '', fromWorker: '', choices: ['mirror', 'always', 'tool'] },
  { key: 'VOICE_BASE_URL', kind: 'text', value: '', fromWorker: '' },
  { key: 'AI_GATEWAY_ID', kind: 'text', value: '', fromWorker: '' }
];
const voiceGroup = page.CONFIG_GROUPS.find((group) => group.id === 'voice');
const metaOf = (key) => voiceGroup.fields.find((meta) => meta.key === key);
page.config = { fields: voiceFields('') };
assert.equal(page.shown(metaOf('VOICE_PROVIDER')), true);
assert.equal(page.shown(metaOf('VOICE_MODEL')), false);
page.config = { fields: voiceFields('elevenlabs') };
assert.equal(page.shown(metaOf('VOICE_MODEL')), true);
assert.ok(page.picksFor(metaOf('VOICE_MODEL')).includes('eleven_v3'));
assert.equal(page.textInEffect(metaOf('VOICE_MODEL')), 'eleven_v4');
assert.equal(page.tagText(metaOf('VOICE_ID')), '要填');
const saved = [];
page.saveConfig = (key, text) => saved.push([key, text]);
page.pickText(metaOf('VOICE_MODEL'), 'eleven_v4');
page.pickText(metaOf('VOICE_MODEL'), 'eleven_v3');
assert.deepEqual(saved, [['VOICE_MODEL', 'eleven_v3']]);
page.config = { fields: voiceFields('openrouter') };
assert.ok(page.picksFor(metaOf('VOICE_MODEL')).includes('minimax/speech-2.8-hd'));
assert.equal(page.tagText(metaOf('VOICE_MODEL')), '要填');
assert.equal(page.tagText(metaOf('VOICE_ID')), '');
assert.equal(page.placeholderFor(metaOf('VOICE_ID')), '模型自己的');
console.log('PASS voice settings show once a provider is picked, with that provider\'s models to pick from');
page.config = { fields: [...voiceFields('elevenlabs'), { key: 'STICKERS', kind: 'choice', value: '', fromWorker: '', choices: ['on', 'off'] }, { key: 'TG_ALLOWED', kind: 'text', value: '', fromWorker: '@her' }], voice: { hears: 'whisper', gap: 'VOICE_ID' } };
page.stickers = { on: true, packs: [{ id: 'a' }, { id: 'b' }], left: 0 };
assert.deepEqual(Array.from(page.CONFIG_MENU, (item) => item.id), ['aelios', 'im', 'push', 'voice', 'stickers', 'web', 'tasks', 'mcp', 'heartbeat', 'thinking', 'custom']);
assert.deepEqual(Array.from(page.CONFIG_MENU, (item) => item.title).slice(1, 3), ['聊天渠道', '通知']);
assert.ok(page.CONFIG_MENU.every((item) => item.title), 'every row has a title');
assert.deepEqual(copy(page.SETTINGS_HOME.flatMap((group) => group.rows)).sort(), Array.from(page.CONFIG_MENU, (item) => item.id).sort(), 'the settings list shows each section once');
// IM: only the web while neither door is set up.
page.config.telegram = { from: null, bot: null, here: false, error: null, lastError: null };
page.config.wecom = { gap: 'off', allowed: [], relay: null, error: null, refused: null };
assert.equal(page.sectionSummary('im'), '只在网页上聊');
assert.ok(!page.sectionNeeds('im'));
assert.equal(page.telegramStatus(), '没接。');
// WeCom: what is missing; who is let in; someone shut out.
page.config.wecom = { gap: 'WECOM_AGENT_ID', allowed: [], relay: null, error: null, refused: null };
assert.equal(page.sectionSummary('im'), '企业微信还差AGENT_ID');
assert.match(page.wecomStatus(), /还差AgentId/);
page.config.wecom = { gap: null, allowed: ['heruser'], relay: { amr: true, mp3: true, gif: true, png: true }, error: null, refused: null };
assert.equal(page.sectionSummary('im'), '企业微信 heruser');
assert.ok(!page.sectionNeeds('im'));
page.config.wecom = { gap: null, allowed: [], relay: { amr: false }, error: null, refused: { at: Date.now(), user: 'HerUser' } };
assert.ok(page.sectionNeeds('im'));
assert.match(page.wecomStatus(), /没装转码/);
assert.match(page.wecomStatus(), /挡下了账号 HerUser/);
assert.equal(page.viaLabel('wecom'), '企业微信');
// Telegram: the bot and whether its messages come here; both doors on one line.
page.config.wecom = { gap: null, allowed: ['heruser'], relay: { amr: true }, error: null, refused: null };
page.config.telegram = { from: 'page', bot: 'my_bot', here: false, error: null, lastError: null };
assert.ok(page.sectionNeeds('im'));
assert.equal(page.sectionSummary('im'), 'Telegram 没接好 · 企业微信 heruser');
assert.match(page.telegramStatus(), /@my_bot.*重新接一次/);
page.config.telegram = { from: 'cloudflare', bot: 'my_bot', here: true, error: null, lastError: null };
assert.ok(!page.sectionNeeds('im'));
assert.equal(page.sectionSummary('im'), 'Telegram @my_bot · 企业微信 heruser');
assert.match(page.telegramStatus(), /接好了：@my_bot（token 在 Cloudflare 里）/);
page.config.telegram = { from: 'page', bot: null, here: false, error: 'Telegram 不认这个 token：Unauthorized', lastError: null };
assert.equal(page.telegramStatus(), 'Telegram 不认这个 token：Unauthorized');
assert.equal(page.metaOf('WECOM_STICKERS').def, 'off', 'stickers on WeCom are off unless turned on');
assert.equal(page.metaOf('WECOM_STICKER_BACKGROUND').def, '#EDEDED', 'a see-through sticker background is filled with the light chat grey');
const imGroup = page.CONFIG_GROUPS.find((group) => group.id === 'im');
assert.deepEqual(JSON.parse(JSON.stringify(imGroup.fields.filter((meta) => meta.door).map((meta) => [meta.key, meta.door]))), [['TG_BOT_TOKEN', 'telegram'], ['WECOM_ALLOWED', 'wecom']]);
page.config.telegram = { from: null, bot: null, here: false, error: null, lastError: null };
console.log('PASS the IM section: Telegram and WeCom side by side, each saying how it stands');
assert.equal(page.sectionSummary('voice'), '还差声音');
assert.ok(page.sectionNeeds('voice'));
assert.equal(page.tagText(metaOf('VOICE_ID')), '要填');
assert.equal(page.sectionSummary('stickers'), '开 · 2 个包');
assert.equal(page.sectionSummary('heartbeat'), '不主动找 · 心跳 3 次');
assert.equal(page.tagText(page.metaOf('TG_ALLOWED')), 'Cloudflare：TG_ALLOWED');
page.config.voice = { hears: 'whisper', gap: null };
assert.equal(page.sectionSummary('voice'), 'ElevenLabs · 你发语音才回语音');
assert.match(page.voiceStatus(), /用 ElevenLabs 说话，你发语音才回语音/);
assert.equal(page.helpFor(metaOf('VOICE_ID')), '从 ElevenLabs 的声音库复制 voice id，自己克隆的也行。');
assert.doesNotMatch(page.voiceStatus(), /Gateway/);
page.config.voice = { hears: 'whisper', gap: null, keyFrom: 'aelios' };
assert.match(page.voiceStatus(), /key 用 AI Gateway「aelios」里存的/);
assert.match(page.helpFor(metaOf('VOICE_API_KEY')), /^空着就用 AI Gateway「aelios」的 Provider Keys/);
assert.match(page.helpFor(metaOf('VOICE_API_KEY')), /到「供应商」里改「AI Gateway 的名字」/);
// The gateway's name has one place: first in 供应商, not behind 更多设置, empty with a grey default.
const providers = page.CONFIG_GROUPS.find((group) => group.id === 'custom');
assert.equal(providers.title, '供应商');
assert.equal(providers.fields[0].key, 'AI_GATEWAY_ID');
assert.ok(!providers.fields[0].more);
assert.equal(page.CONFIG_GROUPS.filter((group) => group.fields.some((meta) => meta.key === 'AI_GATEWAY_ID')).length, 1);
assert.equal(page.placeholderFor(providers.fields[0]), 'default');
assert.equal(page.sectionSummary('custom'), 'Gateway default');
page.view = 'config';
page.openSection('voice');
assert.equal(page.sectionTitle(), '语音');
assert.equal(page.hasMore(voiceGroup), true);
page.configBack();
assert.equal(page.configSection, '');
assert.equal(page.sectionTitle(), '设置');
page.fillDrafts();
page.configBack();
assert.equal(page.view, 'chat');
console.log('PASS the settings page opens on a list with a line of state per section; back goes one step at a time');
// Cloud tasks: a card under the reply that sent it, escaped, with https links only; the settings shown once it is on.
const task = { id: 't_0123456789', title: '<b>修</b>错字', status: 'done', sessionUrl: 'https://claude.ai/code/session_1', progress: '', summary: '好了"<img src=x onerror=unsafe()>',
  links: ['https://github.com/o/r/pull/7', 'javascript:unsafe()', 'http://example.com/a'], test: false };
assert.deepEqual(copy(page.taskLinks(task)), [{ url: 'https://claude.ai/code/session_1', text: '打开会话' }, { url: 'https://github.com/o/r/pull/7', text: 'r #7' }], 'https links only');
assert.deepEqual(copy(page.taskLinks({ ...task, sessionUrl: 'javascript:unsafe()', links: [] })), []);
assert.equal(page.taskStatusText('done'), '做完了');
assert.equal(page.taskNote(task), task.summary, 'the title and summary are bound as text, never as HTML');
assert.equal(page.taskNote({ ...task, status: 'working', progress: '改到一半', summary: '' }), '改到一半');
assert.equal(page.taskNote({ ...task, status: 'sent', progress: '', summary: '' }), '派出去了，等它开工');
const taskCard = markup.slice(markup.indexOf('<template x-for="task in row.cards"'));
assert.ok(markup.indexOf('<template x-for="task in row.cards"') > markup.indexOf("row.line.role === 'assistant'") && markup.indexOf('<template x-for="task in row.cards"') < markup.indexOf('<!-- her message -->'), "only under the resident's own lines");
assert.ok(taskCard.includes('@click="openThread(task.thread)" title="打开线程" aria-label="打开线程"><i class="i i-open" aria-hidden="true"></i></button>'), 'a card opens its thread, by an icon with its name');
// Every card has the same way in, whether or not the thread ran in a session elsewhere: the thread, which has the
// session and the links.
const cardActs = taskCard.slice(taskCard.indexOf('<div class="acts">\n                    <button class="icon-btn sm" type="button" x-show="!task.test" @click="openThread(task.thread)" title="打开线程" aria-label="打开线程"><i class="i i-open" aria-hidden="true"></i></button>'));
assert.ok(cardActs.length > 0);
assert.ok(!cardActs.slice(0, cardActs.indexOf('</div>')).includes('<a '), 'no link on the card itself');
// A thread that needs her: its choices are buttons, and the one she picks is said back.
assert.ok(taskCard.includes('@click="choose(task, choice)" x-text="choice"'));
assert.ok(taskCard.includes("x-text=\"'你选了：' + task.chosen\""));
const chose = [];
const chooser = vm.runInContext('testPage()', context);
chooser.notify = () => {};
chooser.poll = async () => {};
chooser.loadTasks = async () => {};
chooser.refresh = async () => {};
chooser.api = async (path, options) => { chose.push([path, options && options.body]); return { ok: true }; };
const asking = { ...task, status: 'needs_you', choices: ['用 A', '用 B'], chosen: null };
await chooser.choose(asking, '用 B');
assert.deepEqual(copy(chose), [['/web/task/choose', { id: 't_0123456789', text: '用 B' }]]);
assert.equal(asking.chosen, '用 B', 'the card shows the choice right away');
await chooser.choose(asking, '用 A');
assert.equal(chose.length, 1, 'a choice is made once');
const refused = { ...asking, chosen: null };
chooser.api = async () => { throw new Error('这张卡已经不等你选了'); };
await chooser.choose(refused, '用 A');
assert.equal(refused.chosen, null, 'a choice that did not get through can be made again');
assert.equal(chooser.sending, 0);
const taskGroup = page.CONFIG_GROUPS.find((group) => group.id === 'tasks');
const taskField = (key) => taskGroup.fields.find((field) => field.key === key);
const taskFields = (on) => [
  { key: 'CLOUD_TASKS', kind: 'choice', value: on, fromWorker: '', choices: ['on', 'off'] },
  { key: 'CLOUD_TASK_GITHUB_TOKEN', kind: 'secret', value: '', fromWorker: '', saved: false, workerHas: false },
  { key: 'CLOUD_TASK_MODEL', kind: 'text', value: '', fromWorker: '' }
];
assert.deepEqual(Array.from(taskGroup.fields, (field) => field.key), ['CLOUD_TASKS', 'CLOUD_TASK_GITHUB_TOKEN', 'CLOUD_TASK_MODEL']);
const github = { on: false, repo: '', url: '', problem: '', tokenPage: 'https://github.com/settings/tokens/new?scopes=repo,workflow&description=Aelios-resident' };
page.config = { fields: taskFields('') };
page.cloud = { on: false, configured: false, origin: 'https://r.example', github, today: 0, limit: 10, tasks: [] };
assert.equal(page.inEffect(taskField('CLOUD_TASKS')), 'off', 'off unless turned on');
assert.equal(page.shown(taskField('CLOUD_TASK_GITHUB_TOKEN')), false);
assert.equal(page.sectionSummary('tasks'), '关');
assert.ok(!page.sectionNeeds('tasks'));
page.config = { fields: taskFields('on') };
assert.equal(page.shown(taskField('CLOUD_TASK_GITHUB_TOKEN')), true);
assert.ok(page.sectionNeeds('tasks'), 'not known to be set up until the resident says so');
page.cloud = { ...page.cloud, on: true, configured: true, mode: 'local', today: 2 };
assert.equal(page.sectionSummary('tasks'), '自己的线程 · 24 小时内派了 2 单');
assert.ok(!page.sectionNeeds('tasks'), 'threads here need nothing more');
page.cloud = { ...page.cloud, mode: 'linux', github: { ...github, on: true, repo: 'octo/resident-hands', url: 'https://github.com/octo/resident-hands' } };
assert.equal(page.sectionSummary('tasks'), '自己的线程 + GitHub Actions · 24 小时内派了 2 单');
assert.ok(!page.sectionNeeds('tasks'));
page.cloud = { ...page.cloud, github: { ...github, on: true, problem: '这个 token 写不了工作流文件：生成时要勾上 workflow。' } };
assert.ok(page.sectionNeeds('tasks'), 'a token that could not set the repository up needs looking at');
// Plain words: one short line each, and the steps folded away.
assert.match(page.groupHint(taskGroup), /线程/);
assert.ok(!/Think|SQLite|子 agent|Harness|Cursor|Secrets|MODEL_NAME/.test(page.groupHint(taskGroup) + taskGroup.fields.map((field) => page.helpFor(field)).join('')));
assert.match(page.helpFor(taskField('CLOUD_TASK_GITHUB_TOKEN')), /可不填/);
assert.ok([page.groupHint(taskGroup), ...taskGroup.fields.map((field) => page.helpFor(field))].every((text) => text.length <= 50), 'one short line each');
assert.ok(html.includes('<summary>怎么接</summary>'), 'the how-to is folded away');
assert.ok(html.includes(':href="cloud.github.tokenPage"') && html.includes('去 GitHub 生成 token'), 'one tap to make the token, with its scopes ticked');
assert.ok(html.includes('私有仓库 <code>resident-hands</code>'));
assert.ok(!/Allow GitHub Actions to create|MODEL_BASE_URL|RESIDENT_URL|scripts\/hands\.mjs|Cursor|cursor\.com|linuxAvailable/.test(html), 'nothing to set up by hand on GitHub');
// A new GitHub token sets the repository up at once; 试一下 next to it tries GitHub Actions itself.
const githubCalls = [];
const githubPage = Object.assign(Object.create(Object.getPrototypeOf(page)), page, {
  cloudBusy: false,
  api: async (path, init) => { githubCalls.push([path, init && init.body]); return { ...page.cloud, github: { ...github, on: true, repo: 'octo/resident-hands' } }; }
});
await githubPage.setUpGitHub();
await githubPage.testTask('linux');
assert.equal(JSON.stringify(githubCalls), JSON.stringify([['/web/tasks/github', {}], ['/web/tasks/test', { execution: 'linux' }]]));
assert.equal(githubPage.cloud.github.repo, 'octo/resident-hands');
// The threads' model: offered once tasks are on; empty means Workers AI's, not the chat's.
const taskModel = taskField('CLOUD_TASK_MODEL');
assert.equal(page.shown(taskModel), true, 'the model is offered once tasks are on');
assert.equal(taskGroup.title, '后台帮忙');
assert.match(page.helpFor(taskModel), /Workers AI 的 glm-4\.7-flash/);
assert.ok(!html.includes('copilot/'));
assert.equal(page.picksFor(taskModel).join('|'), 'anthropic/claude-haiku-5.5|anthropic/claude-sonnet-5.5');
assert.equal(page.pickLabel(taskModel, 'anthropic/claude-haiku-5.5'), 'Claude Haiku（示例）');
assert.equal(page.textInEffect(taskModel), '', 'empty means Workers AI\'s glm-4.7-flash, here and on GitHub Actions');
page.config = { fields: taskFields('on').map((field) => field.key === 'CLOUD_TASK_MODEL' ? { ...field, value: 'my-provider/my-model' } : field) };
assert.equal(page.textInEffect(taskModel), 'my-provider/my-model');
assert.equal(page.linkText('https://github.com/o/r/pull/7'), 'r #7');
console.log('PASS cloud tasks: a card under the reply, escaped and https only; the settings appear once it is turned on');

// Roles: icon buttons with names, a model picked from a list or written in, saved and removed through the API.
assert.ok(html.includes('aria-label="加一个角色" title="加一个角色"') && html.includes('@click="removeRole(row.role)" aria-label="删掉" title="删掉"'));
page.model = { ...page.model, model: 'anthropic/claude-opus-5.5', recent: ['custom/my-model', 'anthropic/claude-opus-5.5'] };
page.aeliosModels = { loaded: true, curated: true, items: [{ id: 'openai/gpt-5.5' }], error: '' };
const picks = page.roleModels();
assert.deepEqual([...picks.slice(0, 3)], ['anthropic/claude-opus-5.5', 'custom/my-model', 'anthropic/claude-sonnet-5.5']);
assert.ok(picks.includes('@cf/zai-org/glm-4.7-flash') && picks.at(-1) === 'openai/gpt-5.5');
assert.equal(new Set(picks).size, picks.length, 'each once');
page.editRole({ name: 'coder', template: '改代码。', model: 'custom/my-model' });
assert.deepEqual([page.roleEdit.fresh, page.roleEdit.pick, page.roleEdit.own], [false, 'custom/my-model', '']);
page.editRole({ name: 'odd', template: 'x', model: 'someone/unlisted' });
assert.deepEqual([page.roleEdit.pick, page.roleEdit.own], ['…', 'someone/unlisted'], 'a model not in the list is shown written in');
assert.equal(page.roleModelText({ model: '' }), '线程的模型');
page.cloud = { ...page.cloud, roles: [{ name: 'coder', template: '改代码。', model: '' }] };
const roleCalls = [];
page.api = async (path, options) => {
  roleCalls.push([path, options.body]);
  return { roles: [{ name: 'coder', template: '改代码。', model: '' }, { name: 'tester', template: '跑测试。', model: 'x/own' }] };
};
// The one being edited shows its form in its place; a new one gets a row of its own at the end.
assert.equal(page.roleRows().map((row) => row.key).join('|'), 'coder');
page.editRole(page.cloud.roles[0]);
assert.deepEqual([page.editingRole(page.roleRows()[0]), page.roleRows().length], [true, 1]);
page.editRole(null);
const rows = page.roleRows();
assert.deepEqual([rows.length, page.editingRole(rows[0]), page.editingRole(rows[1])], [2, false, true]);
Object.assign(page.roleEdit, { name: 'tester', template: '跑测试。', pick: '…', own: ' x/own ' });
await page.saveRole();
assert.equal(JSON.stringify(roleCalls.at(-1)), JSON.stringify(['/web/tasks/roles', { name: 'tester', template: '跑测试。', model: 'x/own' }]));
assert.equal(page.roleEdit, null);
assert.equal(page.cloud.roles.map((role) => role.name).join('|'), 'coder|tester');
page.api = async (path, options) => { roleCalls.push([path, options.body]); return { roles: [] }; };
await page.removeRole({ name: 'tester' });
assert.equal(JSON.stringify(roleCalls.at(-1)), JSON.stringify(['/web/tasks/roles/remove', { name: 'tester' }]));
assert.equal(page.cloud.roles.length, 0);
page.api = async () => { throw new Error('名字用小写英文字母开头'); };
page.editRole(null);
Object.assign(page.roleEdit, { name: '测试', template: 'x' });
await page.saveRole();
assert.equal(page.roleError, '名字用小写英文字母开头');
assert.ok(page.roleEdit, 'what she wrote stays to fix');
page.roleEdit = null;
console.log('PASS roles: icon buttons, a model from the list or written in, saved and removed');

// Threads: a file is fetched as bytes and shown by its kind; a page only inside a sandboxed frame.
assert.ok(html.includes('<iframe class="file-page" sandbox="allow-scripts"'), 'a page runs apart from this one');
assert.ok(!/sandbox="[^"]*allow-same-origin/.test(html));
assert.equal(page.runsText('local'), '在住户这里干');
assert.equal(page.runsText('linux'), '在 GitHub Actions 上干');
assert.equal(page.sizeText(512), '512 B');
assert.equal(page.sizeText(2048), '2.0 KB');
page.thread = { ...page.thread, id: 't_0123456789', loaded: true };
const files = { 'index.html': '<h1>你好</h1><script>1</script>', 'notes.md': '# 笔记', 'logo.png': '\x89PNG', 'blob.bin': '\u0000\u0001' };
const fetched = [];
page.api = async (path, options) => {
  fetched.push(path);
  assert.ok(options && options.bytes, 'a file comes as bytes');
  const name = new URL(path, 'https://r.example').searchParams.get('path');
  return new TextEncoder().encode(files[name]);
};
await page.viewFile({ path: 'index.html', size: 10 });
assert.equal(page.fileView.kind, 'html');
assert.equal(page.fileView.text, files['index.html']);
assert.equal(fetched[0], '/web/thread/file?id=t_0123456789&path=index.html');
await page.viewFile({ path: 'notes.md', size: 6 });
assert.equal(page.fileView.kind, 'markdown');
await page.viewFile({ path: 'logo.png', size: 4 });
assert.equal(page.fileView.kind, 'image');
assert.match(page.fileView.url, /^blob:/);
await page.viewFile({ path: 'blob.bin', size: 2 });
assert.equal(page.fileView.kind, 'other');
assert.equal(page.fileView.text, '');
// A file a reply handed over (make_file): fetched by its key, on a page of its own; back closes it.
assert.ok(html.includes('@click="openChatFile(f)"'), 'a file card under the reply');
page.closeFile();
files['计划.md'] = '# 计划';
page.api = async (path, options) => {
  fetched.push(path);
  assert.ok(options && options.bytes);
  return new TextEncoder().encode(files['计划.md']);
};
page.openChatFile({ key: 'a'.repeat(32), name: '计划.md', size: 8 });
assert.equal(page.view, 'file');
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(fetched.at(-1), '/web/file?key=' + 'a'.repeat(32));
assert.deepEqual([page.fileView.path, page.fileView.kind, page.fileView.text], ['计划.md', 'markdown', '# 计划']);
page.goBack();
assert.deepEqual([page.view, page.fileView.path, page.fileView.key], ['chat', '', '']);
page.closeFile();
assert.equal(page.fileView.path, '');
assert.equal(page.backText(), '回到聊天');
page.view = 'thread';
assert.equal(page.backText(), '回到线程');
page.view = 'chat';
console.log('PASS threads: files come as bytes and show as text, a picture, or a page in a sandboxed frame');
// Keys for sites web_fetch reads: counted in the 搜网和读网页 row, only while reading pages is on.
page.config = { fields: [
  { key: 'WEB_SEARCH', kind: 'choice', value: '', fromWorker: '', choices: ['on', 'off'] },
  { key: 'WEB_FETCH', kind: 'choice', value: '', fromWorker: '', choices: ['on', 'off'] }
] };
page.sites = [];
assert.equal(page.sectionSummary('web'), '搜网开 · 读网页开');
page.sites = [{ host: 'gated.example', names: ['CF-Access-Client-Id', 'CF-Access-Client-Secret'] }];
assert.equal(page.sectionSummary('web'), '搜网开 · 读网页开 · 1 个网站带钥匙');
page.config.fields[1].value = 'off';
assert.equal(page.sectionSummary('web'), '搜网开 · 读网页关');
assert.ok(html.includes('x-if="configSection === \'web\' && inEffect(metaOf(\'WEB_FETCH\')) !== \'off\'"') && html.includes('sitePreset(\'access\')'));
console.log('PASS keys for sites: counted in the 搜网和读网页 row while reading pages is on');
// The key is typed as name : value rows; the page joins them into the lines the resident reads.
page.siteDraft = { site: 'gated.example', lines: [{ name: '', value: '' }] };
assert.equal(page.siteKeyText(), '', 'nothing typed yet');
page.sitePreset('access');
assert.deepEqual(Array.from(page.siteDraft.lines, (line) => line.name), ['CF-Access-Client-Id', 'CF-Access-Client-Secret']);
page.siteDraft.lines[0].value = ' id.access ';
assert.equal(page.siteKeyText(), '', 'a row with no value is not a key yet');
page.siteDraft.lines[1].value = 'CF-Access-Client-Secret: s3cret';
assert.equal(page.siteKeyText(), 'CF-Access-Client-Id: id.access\nCF-Access-Client-Secret: s3cret', 'a value pasted with its name in front');
page.siteDraft.lines.push({ name: 'X-Extra：', value: '1' });
assert.equal(page.siteKeyText().split('\n')[2], 'X-Extra: 1', 'a colon typed after the name');
page.siteDraft = { site: 'raw.githubusercontent.com', lines: [{ name: '', value: 'github_pat_1' }] };
page.sitePreset('token');
assert.deepEqual(JSON.parse(JSON.stringify(page.siteDraft.lines)), [{ name: 'Authorization', value: 'github_pat_1' }], 'a value already typed stays');
assert.equal(page.siteKeyText(), 'Authorization: Bearer github_pat_1');
page.siteDraft.lines[0].value = 'token abc';
assert.equal(page.siteKeyText(), 'Authorization: token abc', 'a value with its own scheme is left alone');
console.log('PASS keys for sites: name : value rows become the key, presets fill the names, pasted names are dropped');
// The heartbeat is on unless turned off, alarms off unless turned on; the 心跳和闹钟 row counts the alarms while they are on.
const chatGroup = page.CONFIG_GROUPS.find((group) => group.id === 'heartbeat');
const chatMeta = (key) => chatGroup.fields.find((meta) => meta.key === key);
page.config = { fields: [
  { key: 'TG_ALLOWED', kind: 'text', value: '@her', fromWorker: '' },
  { key: 'CHECKIN_SCHEDULE', kind: 'text', value: '', fromWorker: '' },
  { key: 'HEARTBEAT', kind: 'text', value: '', fromWorker: '' },
  { key: 'ALARMS', kind: 'choice', value: '', fromWorker: '', choices: ['on', 'off'] }
] };
assert.equal(page.textInEffect(chatMeta('HEARTBEAT')), '3', 'three times unless set');
assert.deepEqual(Array.from(page.picksFor(chatMeta('HEARTBEAT'))), ['0', '1', '3', '5', '10']);
assert.equal(page.inEffect(chatMeta('ALARMS')), 'off');
page.alarms = { on: false, limit: 10, alarms: [{ id: 'a_1', note: '叫她起床', next: '10-25 周日 09:00', when: '每天 09:00' }] };
assert.equal(page.sectionSummary('heartbeat'), '不主动找 · 心跳 3 次');
page.config.fields[3].value = 'on';
assert.equal(page.sectionSummary('heartbeat'), '不主动找 · 心跳 3 次 · 闹钟 1 个');
page.config.fields[2].value = '0';
assert.equal(page.sectionSummary('heartbeat'), '不主动找 · 心跳关 · 闹钟 1 个');
page.config.fields[2].value = '';
const calls = [];
page.api = async (path, options) => { calls.push([path, options && options.body]); return { on: true, limit: 10, alarms: [] }; };
page.notify = () => {};
await page.removeAlarm(page.alarms.alarms[0]);
assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['/web/alarms/remove', { id: 'a_1' }]]);
assert.equal(page.alarms.alarms.length, 0);
assert.ok(html.includes('x-if="configSection === \'heartbeat\' && alarms.alarms.length"') && html.includes('removeAlarm(alarm)'));
console.log('PASS heartbeat three times and alarms off by default; alarms counted in the 心跳和闹钟 row and deleted from the settings page');
// Letter settings: one visible threshold, two conditions, and a fixed recent-chat budget instead of a second knob.
const letterPage = vm.runInContext('testPage()', context);
const thinkingGroup = letterPage.CONFIG_GROUPS.find((group) => group.id === 'thinking');
const threshold = thinkingGroup.fields.find((meta) => meta.key === 'LETTER_TOKEN_THRESHOLD');
const idle = thinkingGroup.fields.find((meta) => meta.key === 'LETTER_IDLE_MINUTES');
assert.ok(threshold, 'the token threshold has its own setting');
assert.equal(letterPage.CONFIG_GROUPS.flatMap((group) => group.fields).filter((meta) => meta.key === threshold.key).length, 1);
assert.equal(Boolean(threshold.more), false, 'the threshold is visible without opening 更多设置');
assert.equal(letterPage.shown(threshold), true);
assert.ok(!html.includes('KEEP_RECENT_TOKENS'), 'the retired recent-token setting is absent from the page');
letterPage.config = { fields: [
  { key: threshold.key, kind: 'text', value: '', fromWorker: '' },
  { key: idle.key, kind: 'text', value: '', fromWorker: '' }
] };
assert.equal(letterPage.field(threshold.key).kind, 'text', 'use the ordinary settings input');
assert.equal(letterPage.placeholderFor(threshold), '30000');
assert.equal(letterPage.textInEffect(threshold), '30000');
assert.match(letterPage.helpFor(threshold), /只接受大于 8000 的整数/);
assert.match(letterPage.helpFor(threshold), /50000/);
assert.match(letterPage.helpFor(threshold), /当前携带的聊天估算，含旧交接信、工具调用和结果、图片/);
assert.match(letterPage.helpFor(threshold), /不含人设、工具定义和历史思考/);
assert.match(letterPage.helpFor(threshold), /不按累计聊天总量算/);
assert.match(letterPage.helpFor(threshold), /同时满足聊天达到 token 门槛、没人说话达到闲置时间（默认 55 分钟）/);
assert.match(letterPage.helpFor(threshold), /连续聊天即使超过门槛也不会立即写/);
assert.match(letterPage.helpFor(threshold), /固定保留最近约 8000 token 原始聊天，整轮问答不拆开；最近一轮本身超过 8000 时整轮保留/);
assert.match(letterPage.helpFor(threshold), /交接信、人设、工具定义另算/);
assert.match(letterPage.helpFor(threshold), /手动 \/handoff 不受门槛限制，但也要有旧内容可收/);
assert.ok(letterPage.groupHint(thinkingGroup).length <= 40, 'the section itself says it in one short line');
assert.match(letterPage.helpFor(idle), /达到门槛后，也要等这么久没人说话/);
assert.match(letterPage.helpFor(idle), /off 只靠手动 \/handoff/);
assert.match(letterPage.helpFor(letterPage.metaOf('HEARTBEAT')), /还没达到写信门槛，或没有旧内容可收/);
console.log('PASS letter settings expose the threshold, remove the old knob, and explain both conditions and fixed recent chat');
// Exercise the real save/clear flow rather than the stub used by the earlier picker tests.
const letterCalls = [];
letterPage.notify = () => {};
letterPage.api = async (path, options) => {
  letterCalls.push([path, options && options.body]);
  if (path === '/web/letter') return {};
  return { fields: letterPage.config.fields.map((field) => field.key === options.body.key ? { ...field, value: options.body.text } : field) };
};
letterPage.fillDrafts();
letterPage.configDraft[idle.key] = '40';
letterPage.configDraft[threshold.key] = '50000';
assert.equal(letterPage.configDirty(threshold.key), true);
await letterPage.saveConfig(threshold.key, letterPage.configDraft[threshold.key]);
assert.equal(letterPage.textInEffect(threshold), '50000');
assert.equal(letterPage.savedHere(threshold.key), true);
assert.equal(letterPage.configDirty(threshold.key), false);
assert.equal(letterPage.configDraft[idle.key], '40', 'saving the threshold leaves other drafts intact');
await letterPage.saveConfig(threshold.key, '');
assert.equal(letterPage.textInEffect(threshold), '30000');
assert.equal(letterPage.savedHere(threshold.key), false);
assert.equal(letterPage.configDraft[threshold.key], '');
assert.deepEqual(JSON.parse(JSON.stringify(letterCalls)), [
  ['/web/config', { key: 'LETTER_TOKEN_THRESHOLD', text: '50000' }],
  ['/web/letter', null],
  ['/web/config', { key: 'LETTER_TOKEN_THRESHOLD', text: '' }],
  ['/web/letter', null]
]);
letterPage.field(threshold.key).fromWorker = '50000';
assert.equal(letterPage.textInEffect(threshold), '50000');
assert.equal(letterPage.placeholderFor(threshold), '50000');
assert.equal(letterPage.tagText(threshold), 'Cloudflare：LETTER_TOKEN_THRESHOLD');
console.log('PASS the letter threshold uses the normal save/clear API, refreshes letter state, and inherits Cloudflare or the default');
// Writing and delivery have independent outcomes. Missing fields never imply an empty successful handoff.
const statePage = vm.runInContext('testPage()', context);
statePage.notify = () => {};
for (const response of [null, {}, { write: null }, { delivery: {} }, { write: {}, delivery: { latest: {} } }]) {
  statePage.setLetter(response);
  assert.equal(statePage.letterCanRetry(), false);
  assert.equal(statePage.letterDeliveryCounts(), '待发送 0 · 待重试 0 · 已暂停 0');
  assert.doesNotMatch(statePage.letterWriteStatus(), /没有旧内容可收|信已写好/);
  assert.doesNotThrow(() => statePage.letterDeliveryDetail());
}
const at = Date.UTC(2026, 9, 25, 12);
for (const [state, label] of [
  ['writing', '正在写信'], ['recovering', '已有恢复任务，正在恢复写信'], ['written', '信已写好'],
  ['empty', '没有旧内容可收，本次未写信'], ['failed', '写信失败，旧聊天仍保留'], ['future', '写信状态未知']
]) {
  statePage.setLetter({ write: { state, at } });
  assert.equal(statePage.letterWriteStatus(), label);
  assert.equal(statePage.letterTime(statePage.letter.write.at), statePage.fmt(at));
  assert.equal(statePage.sectionNeeds('thinking'), state === 'failed');
}
assert.equal(statePage.letterTime(null), '暂无记录');
statePage.setLetter({ write: { state: 'written', at: NaN }, delivery: { pending: -1, failed: '1', blocked: Infinity, latest: { at: 1e100 } } });
assert.equal(statePage.letterTime(statePage.letter.write.at), '暂无记录');
assert.equal(statePage.letter.delivery.latest.at, null);
assert.equal(statePage.letterCanRetry(), false);
console.log('PASS letter write states distinguish failure, no content, and recovery; missing or invalid fields are safe');
const unsafeError = '发送失败：<img src=x onerror=unsafe()> & "请重试"';
const snapshot = (status, failed = 0, blocked = 0, canRetry = failed > 0 || blocked > 0) => ({
  canRetry,
  write: { state: 'written', at, error: unsafeError },
  delivery: { pending: 2, failed, blocked, latest: { id: 'letter_1', at, status, attempts: 6, lastError: unsafeError, sentAt: status === 'sent' ? at + 1000 : null } }
});
for (const [status, label] of [['pending', /待发送/], ['sent', /已确认送达/], ['failed', /发送失败/], ['blocked', /已暂停/]]) {
  statePage.setLetter(snapshot(status, status === 'failed' ? 1 : 0, status === 'blocked' ? 1 : 0));
  assert.match(statePage.letterDeliveryStatus(), label);
  assert.match(statePage.letterDeliveryDetail(), /已尝试 6 次/);
  assert.equal(statePage.letterCanRetry(), status === 'failed' || status === 'blocked');
  assert.equal(statePage.sectionNeeds('thinking'), statePage.letterCanRetry());
  assert.equal(statePage.letterDeliveryDetail().includes('确认送达：'), status === 'sent');
}
// Older failures must remain retryable even when the latest letter was sent successfully.
statePage.config = { fields: [{ key: 'THINKING_EFFORT', kind: 'choice', value: '', fromWorker: '' }] };
statePage.setLetter(snapshot('sent', 3, 4));
assert.equal(statePage.letterCanRetry(), true);
assert.equal(statePage.letterDeliveryCounts(), '待发送 2 · 待重试 3 · 已暂停 4');
assert.match(statePage.sectionSummary('thinking'), /信已写好.*待重试 3.*已暂停 4/);
// Failures left only for an earlier Aelios address or namespace: retrying cannot resend them, so no button.
statePage.setLetter(snapshot('failed', 2, 1, false));
assert.equal(statePage.letterCanRetry(), false);
assert.equal(statePage.letterDeliveryCounts(), '待发送 2 · 待重试 2 · 已暂停 1');
statePage.setLetter(snapshot('sent', 3, 4));
const letterPanel = html.slice(html.indexOf('<template x-if="configSection === \'thinking\'">'), html.indexOf('<template x-for="meta in plainFields(groupOf(configSection))"'));
assert.ok(letterPanel.length > 0 && !letterPanel.includes('x-html'));
for (const binding of ['letterWriteStatus()', "'最近写信时间：' + letterTime(letter.write && letter.write.at)", 'letter.write && letter.write.error', 'letterDeliveryStatus()', 'letterDeliveryCounts()', 'letterDeliveryDetail()', 'letter.delivery.latest && letter.delivery.latest.lastError', 'letterError']) {
  assert.ok(letterPanel.includes('x-text="' + binding + '"'), binding + ' uses text-only binding');
}
assert.equal(statePage.letter.write.error, unsafeError, 'raw error is kept as text, not interpolated into HTML');
assert.equal(statePage.letter.delivery.latest.lastError, unsafeError);
assert.ok(letterPanel.includes('x-show="letterCanRetry()"'));
assert.match(letterPanel, /只重发已写好的信，不调用模型、不重写信/);
assert.match(letterPanel, /最多自动尝试 6 次/);
assert.match(letterPanel, /确认送达不等同于 Aelios 后台记忆处理已完成/);
console.log('PASS delivery states and queue counts stay separate; retry visibility follows what retry can resend, including older failures; error bindings use x-text, never x-html');
const retryCalls = [];
statePage.api = async (path, options) => {
  retryCalls.push([path, options]);
  assert.equal(statePage.letterBusy, 'retry');
  await statePage.retryLetter(); // A second click while in flight sends nothing.
  return snapshot('blocked', 0, 4); // Still paused after the retry, not reported as delivered.
};
await statePage.retryLetter();
assert.deepEqual(JSON.parse(JSON.stringify(retryCalls)), [['/web/letter/retry', { method: 'POST' }]]);
assert.equal(statePage.letterCanRetry(), true);
assert.match(statePage.letterDeliveryStatus(), /已暂停/);
assert.equal(statePage.letterBusy, '');
statePage.api = async (path, options) => { retryCalls.push([path, options]); return snapshot('sent'); };
await statePage.retryLetter();
assert.equal(statePage.letterCanRetry(), false);
await statePage.retryLetter();
assert.equal(retryCalls.length, 2, 'pending-only or sent states cannot trigger a retry');
statePage.setLetter(snapshot('failed', 1));
statePage.configBusy = 'AELIOS_URL';
await statePage.retryLetter();
assert.equal(retryCalls.length, 2, 'do not retry while saving a target change');
statePage.configBusy = '';
statePage.api = async () => { throw new Error(unsafeError); };
await statePage.retryLetter();
assert.equal(statePage.letterBusy, '');
assert.equal(statePage.letterCanRetry(), true, 'request failure preserves retryable deliveries');
assert.match(statePage.letterError, /^重试同步失败：/);
await statePage.loadLetter();
assert.equal(statePage.letterBusy, '');
assert.match(statePage.letterError, /^读取交接信状态失败/);
assert.match(statePage.letterWriteStatus(), /信已写好/, 'a read failure does not invent an empty or failed write');
assert.equal(statePage.sectionNeeds('thinking'), true);
statePage.api = async () => ({});
await statePage.loadLetter();
assert.equal(statePage.letterError, '');
assert.equal(statePage.letter.write, null);
console.log('PASS retry sends only POST /web/letter/retry, handles paused targets and duplicate clicks, and preserves state on network errors');
// Open/save must read the status endpoint. A status read failure must not turn a successful config save into a failure.
const configPage = vm.runInContext('testPage()', context);
const configCalls = [];
configPage.notify = () => {};
for (const name of ['loadMcp', 'loadSites', 'loadStickers', 'loadTasks', 'loadAlarms', 'loadPushState']) configPage[name] = async () => {};
let failRead = false;
configPage.api = async (path, options) => {
  configCalls.push(path);
  if (path === '/web/letter') {
    if (failRead) throw new Error('暂时无法读取');
    return snapshot('sent');
  }
  assert.equal(path, '/web/config');
  return { fields: [{ key: 'LETTER_TOKEN_THRESHOLD', kind: 'text', value: options ? options.body.text : '', fromWorker: '' }] };
};
await configPage.openConfig();
assert.deepEqual(configCalls, ['/web/config', '/web/letter']);
assert.equal(configPage.view, 'config');
assert.equal(configPage.letter.write.state, 'written');
failRead = true;
await configPage.saveConfig('LETTER_TOKEN_THRESHOLD', '50000');
assert.deepEqual(configCalls.slice(2), ['/web/config', '/web/letter']);
assert.equal(configPage.field('LETTER_TOKEN_THRESHOLD').value, '50000');
assert.equal(configPage.configError.LETTER_TOKEN_THRESHOLD, '');
assert.match(configPage.letterError, /读取交接信状态失败/);
assert.equal(configPage.configBusy, '');
console.log('PASS opening and saving config read /web/letter; a failed status read does not misreport a successful settings save');

// The model picker. Without Aelios it browses the catalog the page ships with; with Aelios connected it browses
// Aelios' own model list (what can actually be picked there), falling back to the catalog when that cannot be had.
const pickerPage = (patch = {}) => {
  const picker = vm.runInContext('testPage()', context);
  picker.catalog = [
    { id: 'anthropic/claude-opus-5.5', name: 'claude-opus-5.5', provider: 'Anthropic', hosted: false, desc: 'Opus.' },
    { id: 'openai/gpt-5', name: 'gpt-5', provider: 'OpenAI', hosted: false, desc: 'GPT.' },
    { id: '@cf/zai-org/glm-4.7-flash', name: 'glm-4.7-flash', provider: 'Zhipu AI', hosted: true, desc: 'GLM.' },
    { id: 'anthropic/claude-sonnet-4.5', name: 'claude-sonnet-4.5', provider: 'Anthropic', hosted: false, desc: 'Sonnet.' },
    { id: 'openai/gpt-4o', name: 'gpt-4o', provider: 'OpenAI', hosted: false, desc: '4o.' },
    { id: '@cf/meta/llama-3.3', name: 'llama-3.3', provider: 'Meta', hosted: true, desc: 'Llama.' }
  ];
  picker.model = { model: 'openai/gpt-5', at: null, fallback: '@cf/zai-org/glm-4.7-flash', recent: [], lastUsage: null, memoryOff: false };
  return Object.assign(picker, patch);
};
// Arrays made inside the page's context have another Array; copy them out so deepEqual compares like with like.
const titles = (picker) => Array.from(picker.pickerGroups().map((group) => group.title));
const ids = (picker, title) => Array.from(picker.pickerGroups().find((group) => group.title === title)?.items.map((item) => item.id) ?? []);
const aeliosList = (items, curated = true, error = '') => ({ loaded: true, items, curated, error });
const listed = [
  { id: 'chatgpt/gpt-5', owner: 'chatgpt', main: true },
  { id: 'openrouter/openai/gpt-6.1-sol:floor', owner: 'openrouter', main: false },
  { id: 'anthropic/claude-opus-5-5', owner: 'anthropic', main: true }
];

const plain = pickerPage();
assert.equal(plain.canon('anthropic/claude-opus-5.5'), 'anthropic/claude-opus-5.5');
assert.equal(plain.canon('@cf/zai-org/glm-4.7-flash'), 'workers-ai/@cf/zai-org/glm-4.7-flash');
assert.equal(plain.canon('custom-relay/anthropic/claude-sonnet-4.5'), 'custom-relay/anthropic/claude-sonnet-4.5');
assert.equal(plain.same('anthropic/claude-opus-5.5', 'anthropic/claude-opus-5-5'), false, 'two spellings are two ids: neither is swapped for the other');
assert.equal(plain.same('@cf/zai-org/glm-4.7-flash', 'workers-ai/@cf/zai-org/glm-4.7-flash'), true);
assert.equal(plain.same('openai/gpt-5', 'openai/gpt-4'), false);
assert.equal(plain.same('', ''), false);
console.log('PASS an id is only the same id when it is the same string');

assert.equal(plain.pickerMode(), 'catalog');
assert.match(plain.pickerNote(), /没连 Aelios.*直接走 Cloudflare 的 AI Gateway.*AELIOS_URL 和 AELIOS_API_KEY/, 'without Aelios the picker says the chat goes straight to the gateway');
assert.deepEqual(titles(plain), ['正在用', '常用', 'Anthropic', 'OpenAI', 'Workers AI · Meta']);
assert.equal(plain.entry('anthropic/claude-opus-5-5').desc, 'Opus.', 'the catalog still describes a model spelled the other way');
assert.equal(plain.entry('anthropic/claude-opus-5-5').id, 'anthropic/claude-opus-5-5', 'and the spelling it was given is kept');
console.log('PASS without Aelios the picker browses the shipped catalog as before');

const waiting = pickerPage({ aelios: true });
assert.equal(waiting.pickerMode(), 'loading');
assert.match(waiting.pickerNote(), /正在取 Aelios/);
assert.deepEqual(titles(waiting), ['正在用'], 'no catalog flashes up while Aelios is being asked');
console.log('PASS while Aelios is being asked the picker shows what is in use, not the catalog');

const curated = pickerPage({ aelios: true, aeliosModels: aeliosList(listed), model: { ...plain.model, model: 'chatgpt/gpt-5', recent: ['openai/gpt-5'] } });
assert.equal(curated.pickerMode(), 'aelios');
assert.deepEqual(titles(curated), ['正在用', '最近用过', '常用', 'openrouter'], 'the model in use and the favourite are not listed a second time under their own provider');
assert.deepEqual(ids(curated, '常用'), ['anthropic/claude-opus-5-5'], 'a favourite Aelios lists is shown under the id Aelios lists it by');
assert.equal(curated.pickerGroups().find((group) => group.title === '常用').items[0].main, true);
assert.deepEqual(ids(curated, 'openrouter'), ['openrouter/openai/gpt-6.1-sol:floor']);
assert.equal(curated.pickerGroups().find((group) => group.title === 'openrouter').items[0].main, false, 'a model that would not remember is marked');
assert.ok(!titles(curated).some((title) => /^(Anthropic|OpenAI|Workers AI)/.test(title)), 'the shipped catalog is not browsed');
assert.match(curated.pickerNote(), /你在 Aelios 里存的模型清单/);
assert.equal(curated.entry('anthropic/claude-opus-5-5').desc, 'Opus.', 'the catalog still describes a listed model');
assert.equal(curated.entry('anthropic/claude-opus-5-5').main, true);
console.log('PASS with Aelios connected the picker browses its model list, once per model, marks the ones that would not remember');

const searching = pickerPage({ aelios: true, aeliosModels: aeliosList(listed) });
searching.picker.q = '5.5';
assert.deepEqual(ids(searching, '搜到的'), ['anthropic/claude-opus-5-5'], 'a search with dots finds a dashed version');
searching.picker.q = 'sol:floor';
assert.deepEqual(ids(searching, '搜到的'), ['openrouter/openai/gpt-6.1-sol:floor']);
searching.picker.q = 'custom-mine/tiny';
assert.deepEqual(titles(searching), ['目录里没有'], 'an id nobody lists can still be typed in');
assert.deepEqual(ids(searching, '目录里没有'), ['custom-mine/tiny']);
searching.picker.q = 'anthropic/claude-opus-5.5';
assert.equal(searching.flatPicker()[0].id, 'anthropic/claude-opus-5.5', 'a typed id comes first, exactly as typed, even when Aelios lists another spelling');
assert.deepEqual(ids(searching, '搜到的'), ['anthropic/claude-opus-5-5'], 'and the listed spelling is still there to pick');
searching.picker.q = 'anthropic/claude-opus-5-5';
assert.ok(!titles(searching).includes('目录里没有'), 'an id Aelios lists exactly is not "not listed"');
assert.equal(searching.flatPicker()[0].id, 'anthropic/claude-opus-5-5');
console.log('PASS search runs over Aelios\' list (dots or dashes), and a typed id comes first as typed');

// Cloudflare's catalog, which Aelios hands over when no list is saved, has odd entries for the same model: the nearest
// one is picked, not the first in the catalog's order.
const odd = ['anthropic/anthropic/claude-opus-5.5-fast', 'anthropic/claude-opus-5-5-fast', 'anthropic/anthropic/claude-opus-5.5',
  'anthropic/claude-opus-5-5', 'anthropic/claude-opus-5.5:batch', 'anthropic/claude-opus-5.5', 'openrouter/anthropic/claude-opus-5.5']
  .map((id) => ({ id, owner: id.split('/')[0] }));
const catalogSearch = pickerPage({ aelios: true, aeliosModels: aeliosList([...odd, ...Array.from({ length: 150 }, (_, i) => ({ id: `openrouter/vendor/filler-${i}`, owner: 'openrouter' }))], false) });
for (const [query, first] of [['claude-opus-5.5', 'anthropic/claude-opus-5.5'], ['opus 5.5', 'anthropic/claude-opus-5.5'],
  ['claude-opus-5-5', 'anthropic/claude-opus-5-5'], ['anthropic/claude-opus-5.5', 'anthropic/claude-opus-5.5']]) {
  catalogSearch.picker.q = query;
  assert.equal(catalogSearch.flatPicker()[0].id, first, query);
}
console.log('PASS in Cloudflare\'s catalog a search picks the plain id, not …-fast, …:batch or anthropic/anthropic/…');

const everything = Array.from({ length: 200 }, (_, i) => ({ id: `openrouter/vendor/model-${i}`, owner: 'openrouter' }));
const huge = pickerPage({ aelios: true, aeliosModels: aeliosList(everything, false) });
assert.deepEqual(titles(huge), ['正在用'], 'an uncurated catalog is searched, not browsed');
assert.match(huge.pickerNote(), /一共 200 个模型/);
huge.picker.q = 'model-1';
assert.equal(ids(huge, '搜到的').length, 60, 'and search shows at most 60');
const small = pickerPage({ aelios: true, aeliosModels: aeliosList(everything.slice(0, 40), false) });
assert.ok(titles(small).includes('openrouter'), 'a short list is browsed even when nobody curated it');
assert.equal(small.pickerNote(), '');
console.log('PASS an uncurated catalog of hundreds is searched rather than drawn in full');

const down = pickerPage({ aelios: true, aeliosModels: aeliosList([], false, 'Aelios answered 401') });
assert.equal(down.pickerMode(), 'catalog');
assert.match(down.pickerNote(), /没取到（Aelios answered 401）.*自带的目录/);
assert.ok(titles(down).includes('Anthropic'));
const empty = pickerPage({ aelios: true, aeliosModels: aeliosList([], false) });
assert.equal(empty.pickerMode(), 'catalog');
assert.equal(empty.pickerNote(), '');
console.log('PASS when Aelios cannot give a list the picker falls back to the shipped catalog and says why');

const loader = pickerPage({ aelios: true });
const asked = [];
loader.api = async (path) => { asked.push(path); return { aelios: true, models: listed, curated: true }; };
await loader.loadAeliosModels();
assert.deepEqual(asked, ['/web/models']);
assert.deepEqual([loader.aeliosModels.loaded, loader.aeliosModels.items.length, loader.aeliosModels.curated, loader.aeliosModels.error], [true, 3, true, '']);
loader.api = async () => { throw new Error('网页门断了'); };
await loader.loadAeliosModels();
assert.deepEqual([loader.aeliosModels.loaded, loader.aeliosModels.items.length, loader.aeliosModels.error], [true, 0, '网页门断了']);
loader.api = async (path) => ({ aelios: true, models: [], curated: false, error: 'Aelios answered 401' });
await loader.loadAeliosModels();
assert.equal(loader.aeliosModels.error, 'Aelios answered 401');
const offline = pickerPage({ aelios: false });
offline.api = async () => { throw new Error('should not be asked'); };
await offline.loadAeliosModels();
assert.equal(offline.aeliosModels.loaded, false);
console.log('PASS the list is fetched from /web/models only when Aelios is connected, and a failure is kept as a reason');

const same = pickerPage({ model: { ...plain.model, model: 'anthropic/claude-opus-5.5' } });
same.api = async () => { throw new Error('picking the model already in use must not try it again'); };
same.picker.open = true;
await same.chooseModel('anthropic/claude-opus-5.5');
assert.equal(same.picker.open, false);
const other = pickerPage({ model: { ...plain.model, model: 'anthropic/claude-opus-5.5' } });
const posted = [];
other.api = async (path, init) => { posted.push([path, init?.body?.text]); return { ...plain.model, model: init.body.text }; };
other.refresh = async () => {};
other.notify = () => {};
other.picker.open = true;
await other.chooseModel('anthropic/claude-opus-5-5');
assert.deepEqual(posted, [['/web/model', 'anthropic/claude-opus-5-5']], 'another spelling is another pick, saved exactly as picked');
console.log('PASS choosing the model in use just closes the picker; another spelling is saved as picked');


// The usage timeline: a row on the profile page opens it; three sums on top, then one row per call.
assert.ok(html.includes('<button class="li" type="button" @click="openUsage()"><span class="name">用量</span><span class="val" x-text="usageToday()"></span>'));
assert.ok(html.includes("view === 'usage'"));
const timeline = vm.runInContext('testPage()', context);
const usageAsked = [];
const usageTotals = (calls, extra = {}) => ({ calls, input: 1000, cacheRead: 9000, cacheWrite: 0, output: 500, reasoning: 100, cost: 0.0123, unpriced: 0, ...extra });
const firstRows = [
  { id: 3, at: Date.now(), model: 'anthropic/claude-opus-5-5', kind: 'chat', via: 'telegram', step: 0, input: 12, cacheRead: 30000, cacheWrite: 400, cacheWrite1h: 400, output: 250, reasoning: 80, tools: ['memory_recall'], cost: 0.0123 },
  { id: 2, at: Date.now(), model: '@cf/zai-org/glm-4.7-flash', kind: 'compress', via: '', step: 0, input: 2000, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 100, reasoning: 0, tools: [], cost: null }
];
timeline.api = async (path) => {
  usageAsked.push(path);
  return path === '/web/usage'
    ? { totals: { today: usageTotals(2), week: usageTotals(9, { unpriced: 3 }), month: usageTotals(4, { unpriced: 4, cost: 0 }) }, rows: firstRows, more: true, keepDays: 90 }
    : { totals: null, rows: [{ ...firstRows[1], id: 1 }], more: false, keepDays: 90 };
};
await timeline.openUsage();
assert.equal(timeline.view, 'usage');
assert.equal(timeline.usage.rows.length, 2);
assert.equal(timeline.totalCost(timeline.usage.totals.today), '$0.012');
assert.equal(timeline.totalCalls(timeline.usage.totals.week), '9 次');
assert.equal(timeline.unpricedText(timeline.usage.totals.week), '3 次没价格');
assert.equal(timeline.unpricedText(timeline.usage.totals.today), '');
assert.equal(timeline.unpricedText(timeline.usage.totals.month), '', 'all unpriced is said by the cost line');
assert.equal(timeline.totalCost(timeline.usage.totals.month), '没有价格');
assert.equal(timeline.hitText(timeline.usage.totals.today), '90%');
assert.equal(timeline.hitText({ input: 0, cacheRead: 0, cacheWrite: 0 }), '—');
assert.equal(timeline.totalTokens(timeline.usage.totals.today), 'in 10k · out 500');
assert.equal(timeline.kindText(firstRows[0]), '聊天 · Telegram');
assert.equal(timeline.kindText({ ...firstRows[0], via: '', kind: 'heartbeat', step: 1 }), '心跳 · 工具后');
assert.equal(timeline.kindText(firstRows[1]), '压缩网页');
assert.equal(timeline.rowNums(firstRows[0]), 'new 12 · read 30,000 · write 400 (1h) · out 250 (think 80)');
assert.equal(timeline.rowNums({ ...firstRows[0], cacheWrite1h: 0 }), 'new 12 · read 30,000 · write 400 (5m) · out 250 (think 80)');
assert.equal(timeline.rowNums({ ...firstRows[0], cacheWrite1h: 100 }), 'new 12 · read 30,000 · write 400 (1h 100) · out 250 (think 80)');
assert.equal(timeline.rowNums(firstRows[1]), 'new 2,000 · read 0 · write 0 · out 100');
assert.equal(timeline.money(1.234), '$1.23');
assert.equal(timeline.money(0.00042), '$0.0004');
await timeline.moreUsage();
assert.deepEqual(usageAsked, ['/web/usage', '/web/usage?before=2']);
assert.equal(timeline.usage.rows.length, 3);
assert.equal(timeline.usage.more, false);
assert.equal(timeline.backText(), '回去');
timeline.goBack();
assert.equal(timeline.view, 'profile', 'back to the profile it was opened from');
console.log('PASS the usage timeline opens from the profile, sums today, 7 and 30 days, lists each call and pages back');

// Saying something: the words, pictures and the line she quotes go to /web/say in one request; it shows at once and
// gives way to the server's copy. Two sent together each wait for their own copy; one that failed can be sent again.
const talk = vm.runInContext('testPage()', context);
const said = [];
let serverLines = [];
let answer = { status: 'completed' };
talk.authed = true;
for (const name of ['loadModel', 'loadAlarms', 'loadTasks']) talk[name] = async () => {};
talk.poll = () => {};
talk.api = async (path, options) => {
  if (path === '/web/messages') return { data: serverLines };
  said.push([path, options && options.body]);
  if (answer instanceof Error) throw answer;
  return answer;
};
talk.lines = [{ id: 'a0', role: 'assistant', text: '上次那只猫呢', kind: 'chat', via: 'web', at: 1 }];
talk.quote = { id: 'a0', who: 'assistant', text: '上次那只猫呢' };
talk.pics = [{ url: 'blob:one', data: 'AAAA' }];
talk.draft = '  在这儿  ';
assert.equal(talk.canSend(), true);
const first = talk.sendDraft();
assert.deepEqual(copy(said[0]), ['/web/say', { text: '在这儿', pictures: [{ data: 'AAAA' }], quote: 'a0' }]);
assert.deepEqual([talk.draft, talk.pics.length, talk.quote], ['', 0, null], 'the box is cleared');
assert.equal(talk.outbox.length, 1);
assert.deepEqual(copy([talk.outbox[0].text, talk.outbox[0].pics, talk.outbox[0].quote.id, talk.outbox[0].state]), ['在这儿', ['blob:one'], 'a0', 'sending']);
assert.deepEqual(copy(talk.rows().slice(-2).map((row) => row.type)), ['local', 'typing'], 'shown before the server has it, with the dots under it');
const second = talk.sendSticker({ key: '0123456789abcdef01234567', video: false });
assert.deepEqual(copy(said[1]), ['/web/say', { sticker: '0123456789abcdef01234567' }]);
assert.equal(talk.outbox.length, 2);
// The server has only the first so far: only the first gives way.
serverLines = [...talk.lines, { id: 'u1', role: 'user', text: '在这儿', kind: 'chat', via: 'web', at: 2, pictures: 1 }];
talk.lines = serverLines;
talk.settleOutbox();
assert.deepEqual(copy(talk.outbox.map((item) => item.payload.sticker || item.payload.text)), ['0123456789abcdef01234567']);
talk.settleOutbox();
assert.equal(talk.outbox.length, 1, 'her first line does not settle the second as well');
serverLines = [...serverLines, { id: 'u2', role: 'user', text: '', kind: 'chat', via: 'web', at: 3, stickers: [{ url: '/stickers/0123456789abcdef01234567', video: false }] }];
await Promise.all([first, second]);
assert.equal(talk.outbox.length, 0);
answer = new Error('网断了');
talk.draft = '再说一句';
await talk.sendDraft();
assert.equal(talk.outbox.length, 1);
assert.deepEqual([talk.outbox[0].state, talk.outbox[0].error], ['failed', '网断了']);
assert.equal(talk.sending, 0);
answer = { status: 'completed' };
serverLines = [...serverLines, { id: 'u3', role: 'user', text: '再说一句', kind: 'chat', via: 'web', at: 4 }];
await talk.retry(talk.outbox[0]);
assert.deepEqual(copy(said.at(-1)), ['/web/say', { text: '再说一句' }], 'sent again as it was');
assert.equal(talk.outbox.length, 0);
answer = { status: 'interrupted' };
talk.draft = '喂';
await talk.sendDraft();
assert.match(talk.outbox[0].error, /没回出来（interrupted）/, 'a reply that did not finish says so');
console.log('PASS words, pictures, a quote and stickers go in one /web/say; each shows at once and gives way to its own copy; a failed one is sent again');

// Quoting from the long-press menu, and how a voice message's length reads.
talk.lines = [{ id: 'a9', role: 'assistant', text: '  好多\n话  ', kind: 'chat', via: 'web', at: 5 }, { id: 'u9', role: 'user', text: '', kind: 'chat', via: 'web', at: 6, voice: { key: null, seconds: 3 } }];
talk.identity.name = '小助手';
talk.menu = { open: true, id: 'a9' };
talk.quoteFromMenu();
assert.deepEqual(copy(talk.quote), { id: 'a9', who: 'assistant', text: ' 好多 话 ' });
assert.equal(talk.menu.open, false);
assert.equal(talk.quoteName('assistant'), '小助手');
assert.equal(talk.quoteName('user'), '你');
talk.menu = { open: true, id: 'u9' };
talk.quoteFromMenu();
assert.equal(talk.quote.text, '[语音]');
assert.equal(talk.voiceLen({ seconds: 3.4 }), '0:03');
assert.equal(talk.voiceLen({ seconds: 75 }), '1:15');
assert.equal(talk.voiceLen({ seconds: 0 }), '');
console.log('PASS a quote is a short excerpt of the line held; voice lengths read as m:ss');

// A recording becomes a 16 kHz mono WAV.
const wav = vm.runInContext('encodeWav([new Float32Array(4800).fill(0.5), new Float32Array(4800).fill(-0.5)], 48000, 16000)', context);
const view = new DataView(wav.buffer);
assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
assert.equal(view.getUint16(22, true), 1, 'mono');
assert.equal(view.getUint32(24, true), 16000);
assert.equal(view.getUint32(40, true), 3200 * 2, '0.2 s at 16 kHz');
assert.ok(view.getInt16(44, true) > 16000 && view.getInt16(44 + 3199 * 2, true) < -16000);
console.log('PASS a recording is made a 16 kHz mono WAV');

// The chat doors as steps: a door not started is just a button; the first step not done is open, the rest fold.
const doors = vm.runInContext('testPage()', context);
const imFields = (values) => ['TG_BOT_TOKEN', 'TG_ALLOWED', 'WECOM_ALLOWED', 'WECOM_CORP_ID', 'WECOM_AGENT_ID', 'WECOM_SECRET', 'WECOM_RELAY_URL', 'WECOM_RELAY_KEY', 'WECOM_TOKEN', 'WECOM_AES_KEY', 'WECOM_STICKERS', 'WECOM_STICKER_BACKGROUND']
  .map((key) => ({ key, kind: /TOKEN$|SECRET|KEY$/.test(key) && key !== 'TG_ALLOWED' ? 'secret' : key === 'WECOM_STICKERS' ? 'choice' : 'text', value: values[key] || '', fromWorker: '', saved: Boolean(values[key]), choices: ['on', 'off'] }));
doors.config = { fields: imFields({}), telegram: { from: null }, wecom: { gap: 'off' } };
assert.equal(doors.doorIdle('telegram'), true);
assert.equal(doors.doorIdle('wecom'), true);
assert.deepEqual(copy(doors.doorPill('telegram')), { text: '没接', cls: '' });
doors.toggleStep('wecom', 'start');
assert.equal(doors.doorIdle('wecom'), false, 'the button opens its steps');
assert.deepEqual(copy(doors.doorSteps('wecom').map((step) => [step.id, step.state, step.open])), [['app', 'now', true], ['relay', 'later', false], ['receive', 'later', false], ['who', 'later', false], ['stickers', 'extra', false]]);
doors.config = { fields: imFields({ WECOM_CORP_ID: 'ww1', WECOM_AGENT_ID: '1000002', WECOM_SECRET: 's' }), telegram: { from: null }, wecom: { gap: 'WECOM_RELAY_URL' } };
assert.deepEqual(copy(doors.doorSteps('wecom').map((step) => step.state)), ['done', 'now', 'later', 'later', 'extra']);
assert.deepEqual(copy(doors.doorPill('wecom')), { text: '差 3 步', cls: 'warn' });
assert.equal(doors.doorSteps('wecom')[0].open, false, 'a step done folds away');
doors.toggleStep('wecom', 'app');
assert.equal(doors.doorSteps('wecom')[0].open, true, 'and opens again when tapped');
assert.equal(doors.stepSummary(doors.doorSteps('wecom')[0]), '都填好了');
assert.ok(doors.doorSteps('wecom')[2].url, 'the receive step shows the address to paste into WeCom');
doors.config = { fields: imFields({ TG_BOT_TOKEN: 'x', TG_ALLOWED: '@her' }), telegram: { from: 'page', bot: 'my_bot', here: true }, wecom: { gap: 'off' } };
assert.deepEqual(copy(doors.doorPill('telegram')), { text: '已连', cls: 'ok' });
assert.equal(doors.stepSummary(doors.doorSteps('telegram')[1]), '@her');
doors.config.telegram.here = false;
assert.deepEqual(copy(doors.doorPill('telegram')), { text: '没接好', cls: 'warn' });
assert.ok(html.includes('x-show="!doorIdle(door)"'));
console.log('PASS the chat doors are steps: not started is one button, the step to do is open, the done ones fold with a summary');

// Pills say how a setting stands in colour: to fill in, or saved here.
doors.config = { fields: [{ key: 'VOICE_ID', kind: 'text', value: '', fromWorker: '' }, { key: 'AELIOS_URL', kind: 'text', value: 'https://a.example', fromWorker: '' }], voice: { gap: 'VOICE_ID' } };
assert.equal(doors.tagClass(doors.metaOf('VOICE_ID')), 'warn');
assert.equal(doors.tagClass(doors.metaOf('AELIOS_URL')), 'ok');
console.log('PASS setting pills: 要填 warns, 已存 is calm');

// Alarms it set show as cards: still there (with how it repeats), or gone.
const ring = vm.runInContext('testPage()', context);
ring.alarms = { on: true, limit: 10, alarms: [{ id: 'a_1', note: '叫她起床', next: '10-26 周一 09:00', when: '每天 09:00', edit: 'time', date: '', time: '09:00' }] };
const setAlarm = (id, output) => ({ type: 'tool', id, name: 'set_alarm', input: '{}', output: JSON.stringify(output), state: 'output-available' });
const cards = ring.alarmCardsOf({ activity: [setAlarm('x', { id: 'a_1', note: '叫她起床', rings: '明天 09:00', repeat: 'every day' }), setAlarm('y', { id: 'a_2', note: '喝水', rings: '15:00' }), { type: 'tool', id: 'z', name: 'set_alarm', input: '{}', output: 'not json', state: 'output-available' }] });
assert.deepEqual(copy(cards.map((card) => [card.id, card.rings, card.when, card.alive])), [['a_1', '10-26 周一 09:00', '每天 09:00', true], ['a_2', '15:00', '一次', false]]);
assert.equal(ring.nextAlarm(), '1 个 · 下次 10-26 周一 09:00');
ring.editAlarm(cards[0].alarm);
assert.deepEqual(copy([ring.alarmEdit.open, ring.alarmEdit.id, ring.alarmEdit.kind, ring.alarmEdit.time]), [true, 'a_1', 'time', '09:00']);
console.log('PASS alarms it set are cards in the chat, alive or gone, and can be moved from there');

// Notifications are offered once in the chat, where the browser can have them, and not again after 以后再说.
const asker = vm.runInContext('testPage()', context);
asker.lines = [1, 2, 3].map((n) => ({ id: 'l' + n, role: 'user', text: 'x', kind: 'chat', via: 'web', at: n }));
Object.assign(asker.push, { supported: true, on: false, ios: false, standalone: false, asked: '' });
assert.equal(asker.pushInvite(), true);
asker.miniApp = true;
assert.equal(asker.pushInvite(), false, 'not inside Telegram');
asker.miniApp = false;
asker.push.ios = true;
assert.equal(asker.pushInvite(), false, 'on iPhone only once it is on the home screen');
asker.push.standalone = true;
assert.equal(asker.pushInvite(), true);
asker.dismissPush();
assert.equal(asker.pushInvite(), false);
assert.ok(readFileSync('public/sw.js', 'utf8').includes("addEventListener('push'"));
console.log('PASS notifications are offered once, only where they can work');

// The conversation keeps to its bottom while she is there: new lines, however tall, the keyboard or the + panel
// making it shorter, a sticker loading. Scrolled up, it stays where she reads, and opening a fold does not pull it.
const scroller = vm.runInContext('testPage()', context);
const listeners = {};
const stream = { scrollHeight: 2000, scrollTop: 1400, clientHeight: 600, addEventListener(name, fn) { listeners[name] = fn; } };
scroller.$refs = { stream };
scroller.authed = true;
for (const name of ['loadModel', 'loadAlarms', 'loadTasks']) scroller[name] = async () => {};
let served = [{ id: 'a', role: 'assistant', text: '早', kind: 'chat', via: 'web', at: 1 }];
// New lines make the conversation taller once Alpine has drawn them.
let grow = 0;
scroller.$nextTick = (fn) => { stream.scrollHeight += grow; grow = 0; fn(); };
scroller.api = async () => { grow = 900; return { data: served }; };
await scroller.refresh();
assert.equal(stream.scrollTop, stream.scrollHeight, 'at the bottom, it follows a line taller than the margin');
scroller.watchStream();
assert.equal(resized.length, 1);
assert.ok(listeners.load && listeners.loadeddata, 'pictures and stickers that load are followed too');
stream.clientHeight = 300;
stream.scrollTop = 1800;
resized[0]();
assert.equal(stream.scrollTop, stream.scrollHeight, 'the keyboard opens: still the last line above the box');
stream.scrollHeight += 200;
listeners.load();
assert.equal(stream.scrollTop, stream.scrollHeight, 'a sticker loads: still at the bottom');
stream.scrollTop = 500;
scroller.onScroll();
assert.equal(scroller.nearBottom, false);
served = [...served, { id: 'b', role: 'assistant', text: '在吗', kind: 'chat', via: 'web', at: 2 }];
await scroller.refresh();
stream.scrollHeight += grow; // drawn all the same
grow = 0;
assert.deepEqual([stream.scrollTop, scroller.unseen], [500, 1], 'scrolled up: it stays, and counts what came');
resized[0]();
listeners.load();
assert.equal(stream.scrollTop, 500, 'the keyboard or a picture does not pull her down');
stream.scrollTop = stream.scrollHeight - stream.clientHeight;
scroller.onScroll();
assert.equal(scroller.nearBottom, true);
stream.scrollHeight += 800;
scroller.toggleBusy('b');
assert.equal(scroller.nearBottom, false, 'opening a fold at the bottom moves the bottom away');
resized[0]();
assert.equal(stream.scrollTop, stream.scrollHeight - 800 - stream.clientHeight, 'so what she opened stays in view');
console.log('PASS the conversation keeps to its bottom while she is there (new lines, the keyboard, a sticker loading), and stays put when she has scrolled up or opened a fold');

// + opens what it can do, the smiley the stickers, with no tabs between them; the same button again closes it.
const panelPage = vm.runInContext('testPage()', context);
let stickerLoads = 0;
panelPage.loadStickerList = () => { stickerLoads += 1; };
panelPage.togglePanel('tools');
assert.deepEqual([panelPage.panel, panelPage.panelTab], ['open', 'tools']);
panelPage.togglePanel('stickers');
assert.deepEqual([panelPage.panel, panelPage.panelTab, stickerLoads], ['open', 'stickers', 1], 'the smiley switches to the stickers');
panelPage.togglePanel('stickers');
assert.equal(panelPage.panel, '', 'and closes them');
panelPage.togglePanel();
assert.equal(panelPage.panelTab, 'tools');
panelPage.togglePanel('tools');
assert.equal(panelPage.panel, '');
assert.ok(!html.includes('class="tabs"'), 'no 功能 / 表情包 tabs');
assert.ok(html.includes(`@click="togglePanel('tools')"`) && html.includes(`@click="togglePanel('stickers')"`));
console.log('PASS + opens what it can do and the smiley the stickers, without tabs');

// A thread's card that waits for her: 不用了 puts it aside on every card of it at once; a failure puts it back.
const asideCalls = [];
const aside = vm.runInContext('testPage()', context);
aside.notify = () => {};
aside.refresh = async () => {};
aside.loadTasks = async () => {};
const waitingCard = () => ({ id: 't_0123456789', title: '看 PR', status: 'needs_you', choices: [], chosen: '', waiting: true, thread: 't_0123456789' });
aside.lines = [{ id: 'a1', role: 'assistant', kind: 'chat', text: '派了', tasks: [waitingCard()] }, { id: 'a2', role: 'assistant', kind: 'chat', text: '它在等你', tasks: [waitingCard()] }];
aside.cloud = { ...aside.cloud, tasks: [waitingCard(), { ...waitingCard(), id: 't_1111111111', status: 'working', waiting: false }] };
assert.equal(aside.workingTasks(), 2, 'one at work, one waiting for her');
aside.cloud.tasks.push({ ...waitingCard(), id: 't_2222222222', status: 'sent', waiting: false, test: true });
assert.equal(aside.workingTasks(), 2, 'a test from the settings page is not a thread');
aside.cloud.open = 0;
assert.equal(aside.workingTasks(), 0, 'the count the resident gives, as 线程 lists them');
delete aside.cloud.open;
// When something new is said (it comes back with what a thread did), the count is read again.
const counted = [];
const recount = vm.runInContext('testPage()', context);
recount.authed = true;
recount.cloud = { ...recount.cloud, on: true };
recount.loadTasks = async () => { counted.push('tasks'); };
let spoken = [{ id: 'x1', role: 'assistant', kind: 'chat', text: '在', at: 1 }];
recount.api = async () => ({ data: spoken });
await recount.refresh();
assert.equal(counted.length, 1);
await recount.refresh();
assert.equal(counted.length, 1, 'not on every look');
spoken = [...spoken, { id: 'x2', role: 'assistant', kind: 'chat', text: '线程交差了', at: 2 }];
await recount.refresh();
assert.equal(counted.length, 2);
assert.equal(aside.taskStatusText(aside.stateOf(aside.lines[0].tasks[0])), '等你拍板');
aside.api = async (path, options) => { asideCalls.push([path, options.body]); return { ok: true }; };
await aside.settle(aside.lines[0].tasks[0]);
assert.deepEqual(copy(asideCalls), [['/web/task/settle', { id: 't_0123456789' }]]);
assert.deepEqual(aside.lines.map((line) => line.tasks[0].waiting), [false, false], 'both cards of it stop asking');
assert.equal(aside.taskStatusText(aside.stateOf(aside.lines[1].tasks[0])), '处理过了');
assert.equal(aside.taskStatusText(aside.stateOf({ ...waitingCard(), waiting: false, chosen: '好' })), '拍板了');
await aside.settle(aside.lines[0].tasks[0]);
assert.equal(asideCalls.length, 1, 'not twice');
aside.lines = [{ id: 'a3', role: 'assistant', kind: 'chat', text: 'x', tasks: [waitingCard()] }];
aside.api = async () => { throw new Error('这张卡已经不等你了'); };
await aside.settle(aside.lines[0].tasks[0]);
assert.equal(aside.lines[0].tasks[0].waiting, true, 'a put-aside that did not get through is undone');
aside.threads = { loaded: true, on: true, threads: [{ id: 'a', status: 'needs_you', waiting: false }, { id: 'b', status: 'needs_you', waiting: true }, { id: 'c', status: 'working', waiting: false }] };
assert.deepEqual(copy(aside.threadsIn('open').map((thread) => thread.id)), ['b', 'c'], 'a thread put aside is listed with the finished ones');
aside.thread = { ...aside.thread, loaded: true, runs: 'linux', status: 'needs_you', tasks: [{ ...waitingCard(), waiting: false }] };
const report = { id: 'result_t_0123456789', role: 'result', task: 't_0123456789', status: 'needs_you' };
assert.equal(aside.waitingFor(report), null);
assert.match(aside.threadSub(), /处理过了$/);
aside.thread.tasks = [waitingCard()];
assert.equal(aside.waitingFor(report).id, 't_0123456789', 'the report of the task that waits');
assert.equal(aside.waitingFor({ ...report, role: 'user', id: 'task_t_0123456789' }), null, 'not what was asked');
assert.equal(aside.lineState(report), 'needs_you');
// 不用了 sits at the end of the row of buttons it already has (打开会话 on the thread page, 打开线程 in the chat),
// with nothing written to explain it.
const reportRow = html.slice(html.indexOf('<div class="links" x-show='), html.indexOf('<div class="card" x-ref="fileView"'));
assert.ok(reportRow.indexOf('title="打开会话" aria-label="打开会话"><i class="i i-open" aria-hidden="true"></i></a>') < reportRow.indexOf('<button class="icon-btn sm end" type="button" :disabled="Boolean(choosing)" @click="settle(waitingFor(line))" title="不用了" aria-label="不用了">'));
assert.ok(reportRow.includes('choose(waitingFor(line), choice)'));
assert.ok(!html.includes('ask-bar') && !html.includes('这一单在等你拍板') && !html.includes('它就不再挂着等你'));
const cardRow = markup.slice(markup.indexOf('title="打开线程" aria-label="打开线程">'));
assert.ok(cardRow.includes('<button class="icon-btn sm end" type="button" :disabled="Boolean(choosing)" @click="settle(task)" title="不用了" aria-label="不用了">'), 'and at the end of the card in the chat');
assert.match(readFileSync('public/app.css', 'utf8'), /\.icon-btn\.end \{ margin-left: auto; \}/, 'at the right end, also on a wrapped line');
console.log('PASS 不用了 puts aside a card that waits for her, on every card of it, in the thread list and on its page');

// Its page: no row of shortcuts (they are in the chat), a pen for the persona, the model's pill opens the picker,
// and the page scrolls instead of squeezing what is on it.
const profile = html.slice(html.indexOf('<section class="page" x-show="authed && view === \'profile\'">'), html.indexOf('<!-- ===== the persona ===== -->'));
assert.ok(!profile.includes('class="quick"'));
assert.ok(profile.includes('aria-label="改人设"') && !profile.includes('>改</button>'));
assert.ok(profile.includes('<button class="pill" type="button" @click="openPicker()"'));
assert.match(readFileSync('public/app.css', 'utf8'), /\.page > \* \{ flex-shrink: 0; \}/);
console.log('PASS its page: no shortcut row, a pen for the persona, the model pill opens the picker, and it scrolls');


// Markdown: parsed into plain nodes, drawn with createElement and textContent only; nothing is read as HTML, and a
// link opens only an http(s) address.
const md = vm.runInContext('parseMarkdown', context);
const mdReport = '报告已写好。\n\n1. **Web Push 通道**：走 FCM。\n2. **替代方案**：\n   - **ntfy**：要自己有服务器。\n   - *Gotify*：同样要自建。';
assert.deepEqual(copy(md(mdReport)), [
  { t: 'p', c: [{ t: 'text', v: '报告已写好。' }] },
  { t: 'ol', start: 1, items: [
    [{ t: 'p', c: [{ t: 'strong', c: [{ t: 'text', v: 'Web Push 通道' }] }, { t: 'text', v: '：走 FCM。' }] }],
    [{ t: 'p', c: [{ t: 'strong', c: [{ t: 'text', v: '替代方案' }] }, { t: 'text', v: '：' }] },
      { t: 'ul', items: [
        [{ t: 'p', c: [{ t: 'strong', c: [{ t: 'text', v: 'ntfy' }] }, { t: 'text', v: '：要自己有服务器。' }] }],
        [{ t: 'p', c: [{ t: 'em', c: [{ t: 'text', v: 'Gotify' }] }, { t: 'text', v: '：同样要自建。' }] }]
      ] }]
  ] }
]);
const table = md('| 浏览器 | 推送 |\n|---|:-:|\n| Chrome | 走 **FCM** |\n| 小米 | 不支持 |')[0];
assert.equal(table.t, 'table');
assert.deepEqual(copy(table.head.map((cell) => cell[0].v)), ['浏览器', '推送']);
assert.equal(table.rows.length, 2);
assert.equal(table.rows[0][1][1].t, 'strong');
assert.deepEqual(copy(md('```js\nconst a = 1;\n\n<b>x</b>\n```')), [{ t: 'pre', v: 'const a = 1;\n\n<b>x</b>' }], 'code keeps its blank lines and its brackets, as text');
assert.deepEqual(copy(md('# 大标题\n### 小标题\n---\n> 引一句\n~~划掉~~ `code`').map((block) => block.t)), ['h3', 'h4', 'hr', 'blockquote', 'p']);
assert.deepEqual(copy(md('第一行\n第二行')[0].c), [{ t: 'text', v: '第一行' }, { t: 'br' }, { t: 'text', v: '第二行' }], 'a line break stays one');
const unsafe = md('<script>alert(1)</script> <img src=x onerror=alert(1)> [点我](javascript:alert(1)) [好的](https://a.example/p?q=1) 看 https://b.example/x）。 snake_case_name')[0].c;
assert.equal(unsafe[0].t, 'text');
assert.ok(unsafe[0].v.startsWith('<script>alert(1)</script> <img src=x onerror=alert(1)> [点我](javascript:alert(1))'), 'HTML and a javascript: link stay words');
assert.deepEqual(copy(unsafe.filter((node) => node.t === 'a').map((node) => node.href)), ['https://a.example/p?q=1', 'https://b.example/x'], 'an address ends before the punctuation after it');
assert.ok(!unsafe.some((node) => node.t === 'em'), 'snake_case is not italics');
assert.equal(vm.runInContext('markdownPlain', context)('1. **Web Push**：走 [FCM](https://x.example)。\n2. 第二'), 'Web Push：走 FCM。 第二');
// Drawn into a stand-in document: only the elements it knows, words as text nodes, links only to http(s).
const made = [];
const fakeDoc = {
  createElement(tag) {
    const el = { tag, attrs: {}, children: [], className: '', ownerDocument: fakeDoc,
      appendChild(child) { this.children.push(child); return child; },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
      get firstChild() { return this.children[0] || null; },
      setAttribute(name, value) { this.attrs[name] = value; },
      set textContent(value) { this.children = [{ text: String(value) }]; } };
    made.push(tag);
    return el;
  },
  createTextNode(text) { return { text }; }
};
const target = fakeDoc.createElement('div');
target.appendChild({ text: 'old' });
made.length = 0;
vm.runInContext('renderMarkdown', context)(target, mdReport + '\n\n[坏的](javascript:alert(1)) [好的](https://a.example) <script>x</script>\n\n| a | b |\n|---|---|\n| 1 | 2 |');
assert.ok(made.every((tag) => ['p', 'strong', 'em', 'ol', 'ul', 'li', 'a', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td'].includes(tag)), made.join(','));
const links = [];
const walk = (el) => { if (el.tag === 'a') links.push(el.attrs); (el.children || []).forEach(walk); };
walk(target);
assert.deepEqual(links, [{ href: 'https://a.example', target: '_blank', rel: 'noopener noreferrer' }]);
assert.ok(!JSON.stringify(target).includes('"old"'), 'what was there before is replaced');
assert.ok(JSON.stringify(target).includes('<script>x</script>'), 'kept as words in a text node');
assert.ok(html.includes('x-markdown="b.text"') && html.includes('x-markdown="line.text"') && html.includes('x-markdown="fileView.text"'), 'its replies, a thread, and a Markdown file');
assert.ok(!html.includes('x-markdown="row.line.text"'), 'her own words are left as she wrote them');
console.log('PASS Markdown is drawn from a tree of nodes with createElement and textContent: HTML stays words, links only to http(s)');

// A reply with a code block is not split into bubbles at the code's blank lines.
assert.deepEqual(copy(page.bubblesOf({ role: 'assistant', text: '看这个：\n\n```\na\n\nb\n```\n\n好了' }).map((b) => b.text)), ['看这个：', '```\na\n\nb\n```', '好了']);
console.log('PASS a fenced code block stays in one bubble');

// A thread's card shows once, under the newest line about it, as a small card: the report itself is in the thread.
const cardPage = vm.runInContext('testPage()', context);
const doneTask = { id: 't_0123456789', title: '查网页推送', status: 'done', summary: '报告已写好。\n\n1. **Web Push 通道**：走 FCM。', links: ['https://dev.mi.com/a'], sessionUrl: '', waiting: false, thread: 't_0123456789' };
cardPage.lines = [
  { id: 'a1', role: 'assistant', kind: 'chat', via: 'web', text: '派出去了', at: 1, tasks: [{ ...doneTask, status: 'working', summary: '' }] },
  { id: 'a2', role: 'assistant', kind: 'chat', via: 'task', text: '线程交差了', at: 2, tasks: [doneTask] }
];
const cardRows = cardPage.rows().filter((row) => row.type === 'line');
assert.deepEqual(copy(cardRows.map((row) => row.cards.map((card) => card.status))), [[], ['done']], 'once, where it was reported');
assert.equal(cardPage.taskPreview(doneTask), '报告已写好。 Web Push 通道：走 FCM。', 'a preview without the marks');
assert.ok(taskCard.includes('class="note" x-show="taskPreview(task)" x-text="taskPreview(task)"'));
assert.match(readFileSync('public/app.css', 'utf8'), /\.ccard \.note \{[^}]*-webkit-line-clamp: 2/, 'two lines at most');
console.log('PASS a thread shows once in the chat, as a small card with two lines of its report');

// A Markdown file of a thread is drawn as Markdown.
const filePage = vm.runInContext('testPage()', context);
filePage.thread = { ...filePage.thread, id: 't_0123456789', loaded: true };
filePage.api = async () => new TextEncoder().encode('# 报告\n\n- 一');
await filePage.viewFile({ path: '小米网页推送报告.md', size: 10 });
assert.equal(filePage.fileView.kind, 'markdown');
console.log('PASS a thread\'s .md file is shown as Markdown');

// The page's look every few seconds: it says which version it has, and nothing is read or redrawn while the
// resident says nothing has changed; all of it is read when told to, and at least every 2 minutes all the same.
const looker = vm.runInContext('testPage()', context);
const looked = [];
let answers = [];
looker.authed = true;
looker.api = async (path) => { looked.push(path); return answers.shift(); };
const firstLines = [{ id: 'm1', role: 'assistant', kind: 'chat', text: '早', at: 1 }];
answers = [{ data: firstLines, rev: 'b00t.1' }];
await looker.refresh();
assert.equal(looked.at(-1), '/web/messages', 'no version yet: all of it');
answers = [{ same: true, rev: 'b00t.1' }];
await looker.refresh();
assert.equal(looked.at(-1), '/web/messages?since=b00t.1');
assert.equal(looker.lines[0].id, 'm1', 'nothing redrawn');
answers = [{ data: [...firstLines, { id: 'm2', role: 'assistant', kind: 'chat', text: '在吗', at: 2 }], rev: 'b00t.2' }];
await looker.refresh();
assert.equal(looker.lines.length, 2, 'something changed: all of it');
answers = [{ same: true, rev: 'b00t.2' }];
await looker.refresh();
assert.equal(looked.at(-1), '/web/messages?since=b00t.2', 'the new version is the one asked about');
answers = [{ data: looker.lines, rev: 'b00t.2' }];
await looker.refresh(true);
assert.equal(looked.at(-1), '/web/messages', 'told to: all of it (the page shown again)');
const realNow = Date.now;
Date.now = () => realNow() + 3 * 60 * 1000;
answers = [{ data: looker.lines, rev: 'b00t.2' }];
await looker.refresh();
Date.now = realNow;
assert.equal(looked.at(-1), '/web/messages', 'two minutes on: all of it, whatever the version says');
looker.logout();
answers = [{ data: [], rev: 'other.1' }];
looker.authed = true;
await looker.refresh();
assert.equal(looked.at(-1), '/web/messages', 'after locking the door, no version is kept');
console.log('PASS the page asks for what changed since its version, reads all of it when told to and every 2 minutes');

// Searching the conversation: pages of hits put together, a new search starts over, a hit opened reads its
// neighbours once, and the words searched for are marked as text.
const searchMarkup = html.slice(html.indexOf('<!-- ===== searching the conversation ===== -->'), html.indexOf('<!-- ===== threads ===== -->'));
for (const binding of ['x-text="hit.before"', 'x-text="hit.match"', 'x-text="hit.after"', 'x-text="part.text"']) assert.ok(searchMarkup.includes(binding), binding + ' is bound as text');
const searcher = vm.runInContext('testPage()', context);
const searched = [];
let searchAnswers = [];
searcher.api = async (path) => { searched.push(path); return searchAnswers.shift(); };
const hitOf = (id, role) => ({ id, role, at: 1, before: '那家', match: '蓝月亮', after: '' });
searcher.openSearch();
assert.equal(searcher.view, 'search');
searcher.search.q = '  蓝月亮 ';
searchAnswers = [{ results: [hitOf('a', 'assistant'), hitOf('b', 'user')], next: 41 }];
await searcher.runSearch();
assert.equal(searched.at(-1), '/web/search?q=' + encodeURIComponent('蓝月亮'));
assert.equal(searcher.searchSummary(), '找到 2+ 条带「蓝月亮」的，新的在前。点一条看前后。');
searcher.search.q = '别的';
searchAnswers = [{ results: [hitOf('b', 'user'), hitOf('c', 'user')], next: null }];
await searcher.runSearch(true);
assert.equal(searched.at(-1), '/web/search?q=' + encodeURIComponent('蓝月亮') + '&before=41', 'more of the same search, whatever is typed now');
assert.deepEqual(copy(searcher.search.results.map((hit) => hit.id)), ['a', 'b', 'c'], 'a hit on both pages shows once');
assert.equal(searcher.searchSummary(), '找到 3 条带「蓝月亮」的，新的在前。点一条看前后。');
searchAnswers = [{ lines: [{ id: 'z', role: 'user', text: '在吗', at: 1 }, { id: 'b', role: 'user', text: '那家蓝月亮', at: 2, hit: true }] }];
await searcher.toggleHit(searcher.search.results[1]);
assert.equal(searcher.search.open, 'b');
assert.equal(searcher.search.around.b.lines.length, 2);
await searcher.toggleHit(searcher.search.results[1]);
await searcher.toggleHit(searcher.search.results[1]);
assert.equal(searched.filter((path) => path.startsWith('/web/search/around')).length, 1, 'read once');
assert.deepEqual(copy(searcher.markedParts('蓝月亮和藍月亮，还有蓝月亮')), [{ text: '蓝月亮', hit: true }, { text: '和藍月亮，还有' }, { text: '蓝月亮', hit: true }]);
searcher.search.asked = 'moon';
assert.deepEqual(copy(searcher.markedParts('Moonlight')), [{ text: 'Moon', hit: true }, { text: 'light' }], 'letters match either case');
searcher.search.asked = 'café au';
assert.deepEqual(copy(searcher.markedParts('CAFÉ\n  au lait')), [{ text: 'CAFÉ\n  au', hit: true }, { text: ' lait' }], 'as the search finds it: across a line break and a run of spaces, É as é');
searcher.search.asked = 'a.b';
assert.deepEqual(copy(searcher.markedParts('axb a.b')), [{ text: 'axb ' }, { text: 'a.b', hit: true }], 'the words taken as they are, not as a pattern');
searchAnswers = [{ results: [], next: null }];
searcher.search.q = '没有的';
await searcher.runSearch();
assert.deepEqual(copy(searcher.search.results), [], 'a new search starts over');
assert.equal(searcher.search.open, '');
assert.equal(searcher.searchSummary(), '没找到「没有的」。');
searcher.search.q = '出错';
searcher.api = async () => { throw new Error('最多搜 50 个字'); };
await searcher.runSearch();
assert.equal(searcher.search.error, '最多搜 50 个字');
searcher.logout();
assert.equal(searcher.search.q, '', 'the search is not kept after locking the door');
console.log('PASS search: pages of hits put together once each, a new search starts over, a hit read once, the words marked as text');

// The group chat pages (public/group.js): groups made from the sidebar, tapping an avatar calls it, what is said is
// bound as text (a resident's as Markdown, in bubbles), pictures and stickers sent, the settings send who is ticked,
// the icon changed, and what a group handed a resident is marked in its own chat.
const groupMarkup = html.slice(html.indexOf('<!-- ===== a group chat'), html.indexOf('<!-- ===== threads ===== -->'));
assert.ok(groupMarkup.includes('x-text="b.text"') && groupMarkup.includes('x-markdown="b.text"') && !groupMarkup.includes('x-html'), 'what is said in a group is bound as text or Markdown, never as HTML');
assert.ok(html.indexOf('<script src="/group.js"></script>') < html.indexOf('<script src="/app.js"></script>'), 'group.js is there before app.js mixes it in');
const grouper = vm.runInContext('testPage()', context);
grouper.residents.list = [{ id: 'default', name: '旦九', avatar: null }, { id: 'mochi', name: '麻薯', avatar: null }, { id: 'kiki', name: 'Kiki', avatar: null }];
assert.equal(grouper.groupOn(), true);
const groupCalls = [];
let groupAnswer = {};
grouper.api = async (path, options) => { groupCalls.push([path, options && options.body]); return groupAnswer; };
grouper.newGroup();
assert.deepEqual(copy(grouper.groupEdit.on), { default: true, mochi: true, kiki: true }, 'everyone ticked to start with');
grouper.groupEdit.on.kiki = false;
grouper.groupEdit.name = '周末';
groupAnswer = { group: { id: 'g1', name: '周末', members: ['default', 'mochi'], reply: 'all', order: 'list' }, lines: [], more: false, groups: [] };
await grouper.saveGroupEdit();
assert.deepEqual(copy(groupCalls[0]), ['/web/groups', { name: '周末', members: ['default', 'mochi'], reply: 'all', order: 'list', rounds: 3 }], 'three rounds unless set');
assert.deepEqual([grouper.view, grouper.group.id, grouper.groupEdit], ['group', 'g1', null], 'the new group opens');
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(grouper.group.name, '周末');
grouper.group.members = ['default', 'mochi'];
grouper.callInGroup('mochi');
assert.equal(grouper.group.draft, '@麻薯 ');
grouper.group.draft = '你好';
grouper.callInGroup('default');
assert.equal(grouper.group.draft, '你好 @旦九 ');
assert.equal(grouper.groupStatus(), '2 个住户和你');
grouper.group.speaking = 'mochi';
assert.equal(grouper.groupStatus(), '麻薯 正在想…');
assert.equal(grouper.groupMember('gone').name, 'gone', 'a resident deleted since is shown by its id');
groupAnswer = { line: { seq: 7, author: '', text: '你好 @旦九', at: 1, kind: 'say' } };
grouper.group.draft = '  你好 @旦九 ';
await grouper.sayInGroup();
assert.deepEqual(copy(groupCalls.at(-1)), ['/web/group/say?g=g1', { text: '你好 @旦九' }]);
assert.equal(grouper.group.draft, '');
assert.ok(grouper.group.lines.some((line) => line.seq === 7));
// A reply that reached the server while she was writing is still fetched after her line is put in.
grouper.view = 'group';
grouper.group.lines = [{ seq: 1, author: '', text: '在吗', at: 1, kind: 'say' }];
grouper.group.seen = 1;
groupAnswer = { line: { seq: 3, author: '', text: '人呢', at: 3, kind: 'say' } };
grouper.group.draft = '人呢';
await grouper.sayInGroup();
groupAnswer = { lines: [{ seq: 2, author: 'mochi', text: '在', at: 2, kind: 'say' }, { seq: 3, author: '', text: '人呢', at: 3, kind: 'say' }] };
await grouper.groupNews();
assert.equal(groupCalls.at(-1)[0], '/web/group?g=g1&after=1', 'asked after the last line the server handed it, not her own');
assert.deepEqual(grouper.group.lines.map((line) => line.seq), [1, 2, 3], 'once each, in order');
groupAnswer = { lines: [] };
await grouper.groupNews();
assert.equal(groupCalls.at(-1)[0], '/web/group?g=g1&after=3');
// Pictures picked below the box go with the words and are cleared; a sticker goes on its own, from her packs on the page she came from.
grouper.resident = 'mochi';
grouper.pics = [{ url: 'blob:1', data: 'AAAA' }];
grouper.group.draft = '看图';
assert.equal(grouper.canSayInGroup(), true);
groupAnswer = { line: { seq: 4, author: '', text: '看图', at: 4, kind: 'say', pictures: 1 } };
await grouper.sayInGroup();
assert.deepEqual(copy(groupCalls.at(-1)), ['/web/group/say?g=g1', { text: '看图', pictures: [{ data: 'AAAA' }] }]);
assert.deepEqual([grouper.pics.length, grouper.group.draft], [0, '']);
groupAnswer = { line: { seq: 5, author: '', text: '', at: 5, kind: 'say', stickers: [{ url: '/r/mochi/stickers/' + 'a'.repeat(24), video: false, mark: '[sticker]' }] } };
await grouper.sayInGroup({ key: 'b'.repeat(24) });
assert.deepEqual(copy(groupCalls.at(-1)), ['/web/group/say?g=g1', { sticker: { from: 'mochi', key: 'b'.repeat(24) } }]);
// A resident's words in bubbles as in the chat; only stickers from a resident's own address are shown.
assert.deepEqual(copy(grouper.groupBubbles({ author: 'mochi', text: '好呀\n\n我也去' }).map((b) => b.text)), ['好呀', '我也去']);
assert.deepEqual(copy(grouper.groupBubbles({ author: '', text: '第一行\n\n第二行' }).map((b) => b.text)), ['第一行\n\n第二行'], 'hers stay in one');
assert.equal(grouper.groupStickers({ stickers: [{ url: '/r/mochi/stickers/' + 'c'.repeat(24) }, { url: '/stickers/' + 'd'.repeat(24) }, { url: 'https://evil.example/x.png' }, { url: '/r/mochi/stickers/../x' }] }).length, 2);
assert.deepEqual(copy(grouper.groupPics({ pictures: 6 })), [0, 1, 2, 3]);
// A picture is asked for once while it loads; after switching residents empties the pictures, it is asked again and shown.
let picAsked = 0;
const groupApi = grouper.api;
grouper.api = async (path, options) => {
  if (!path.includes('group/picture')) return groupApi(path, options);
  picAsked += 1;
  return new Blob(['x'], { type: 'image/png' });
};
const pictured = { seq: 4, pictures: 1 };
assert.deepEqual([grouper.groupPicUrl(pictured, 0), grouper.groupPicUrl(pictured, 0), picAsked], ['', '', 1], 'not asked twice while it loads');
await new Promise((resolve) => setTimeout(resolve, 0));
assert.match(grouper.groupPicUrl(pictured, 0), /^blob:/);
grouper.picUrls = {};
grouper.groupPicUrl(pictured, 0);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual([/^blob:/.test(grouper.groupPicUrl(pictured, 0)), picAsked], [true, 2], 'asked again once the pictures were emptied, and shown');
grouper.api = groupApi;
grouper.openGroupSettings();
assert.deepEqual(copy(grouper.groupEdit.on), { default: true, mochi: true, kiki: false }, 'its members ticked');
grouper.groupEdit.on.kiki = true;
grouper.groupEdit.reply = 'one';
grouper.groupEdit.rounds = '2';
// The icon: the list that comes back gives it to the sheet, the sidebar and the open group.
groupAnswer = { groups: [{ id: 'g1', name: '周末', members: ['default', 'mochi'], icon: '/avatar/' + 'e'.repeat(32) }] };
await grouper.removeGroupIcon();
assert.equal(groupCalls.at(-1)[0], '/web/group/icon/remove?g=g1');
assert.deepEqual([grouper.groupEdit.icon, grouper.groups[0].icon, grouper.group.config.icon], ['/avatar/' + 'e'.repeat(32), '/avatar/' + 'e'.repeat(32), '/avatar/' + 'e'.repeat(32)]);
groupAnswer = { group: { id: 'g1', name: '周末', members: ['default', 'mochi', 'kiki'], reply: 'one', order: 'list', rounds: 2 }, groups: [] };
await grouper.saveGroupEdit();
assert.deepEqual(copy(groupCalls.find((call) => call[0].startsWith('/web/group/config'))), ['/web/group/config?g=g1', { name: '周末', members: ['default', 'mochi', 'kiki'], reply: 'one', order: 'list', rounds: 2 }]);
assert.equal(grouper.groupEdit, null, 'closed once saved');
console.log('PASS group chat pages: made from the sidebar with who is ticked, an avatar tapped is @ and its name, bubbles as in the chat, pictures and stickers sent, only own stickers shown, a reply not fetched yet is not skipped, a picture asked again after switching residents, rounds and icon in the settings');
// Its latest reply can be taken back from its long-press menu: deleted (asked first), or answered again (the dots
// show until the new one). Other messages' menus do not have the two.
const back = vm.runInContext('testPage()', context);
const takes = [];
back.api = async (path, options) => { takes.push([path, copy(options.body)]); return path === '/web/take-back' && options.body.again ? { status: 'completed' } : { status: 'removed' }; };
back.poll = () => {};
back.refresh = async () => {};
back.lines = [
  { id: 'u1', role: 'user', text: '在吗', kind: 'chat', via: 'web' },
  { id: 'a1', role: 'assistant', text: '我不能完成这个任务。', kind: 'chat', via: 'web' },
  { id: 'n1', role: 'assistant', text: '换成了 x', kind: 'notice', via: null }
];
assert.equal(back.takeBackable(back.lines[1]), true, 'the latest reply; a notice after it does not count');
assert.equal(back.takeBackable(back.lines[0]), false, 'not her message');
back.lines.push({ id: 'u2', role: 'user', text: '？', kind: 'chat', via: 'web' });
assert.equal(back.takeBackable(back.lines[1]), false, 'not once she has said something after it');
back.lines.pop();
back.lines[1].pending = true;
assert.equal(back.takeBackable(back.lines[1]), false, 'not while it is still coming');
delete back.lines[1].pending;
assert.equal(back.answersHer(back.lines[1]), true);
assert.equal(back.answersHer({ ...back.lines[1], via: 'checkin' }), false, 'a check-in can only be deleted');
assert.ok(!html.includes('class="take-back"'), 'nothing hangs under the reply any more');
assert.match(html, /x-show="menuTakesBack\(\) && answersHer\(menuLine\(\)\)" @click="takeBackFromMenu\(true\)">[\s\S]*?重新生成<\/button>/);
assert.match(html, /x-show="menuTakesBack\(\)" @click="takeBackFromMenu\(false\)">[\s\S]*?删掉<\/button>/);
back.menu = { open: true, id: 'u1' };
assert.equal(back.menuTakesBack(), false, 'her message\'s menu has neither');
back.lines.unshift({ id: 'a0', role: 'assistant', text: '更早的', kind: 'chat', via: 'web' });
back.menu = { open: true, id: 'a0' };
assert.equal(back.menuTakesBack(), false, 'nor an earlier reply\'s');
back.menu = { open: true, id: 'a1' };
assert.equal(back.menuTakesBack(), true, 'the latest reply\'s menu has them');
back.closeMenu();
assert.equal(back.menuTakesBack(), false, 'not once the menu is shut');
back.lines.shift();
back.menu = { open: true, id: 'a1' };
const again = back.takeBackFromMenu(true);
assert.equal(back.menu.open, false, 'the menu shuts');
assert.equal(back.waiting(), true, 'the old reply goes at once and the dots show');
assert.equal(back.takeBackable(back.lines[1] || {}), false);
await again;
assert.deepEqual(takes, [['/web/take-back', { id: 'a1', again: true }]]);
assert.deepEqual([back.sending, back.takingBack], [0, false]);
back.lines = [{ id: 'u1', role: 'user', text: '在吗', kind: 'chat', via: 'web' }, { id: 'a2', role: 'assistant', text: '��', kind: 'chat', via: 'web' }];
context.confirm = () => false;
back.menu = { open: true, id: 'a2' };
await back.takeBackFromMenu(false);
assert.equal(takes.length, 1, 'a no to 删掉这条？ deletes nothing');
context.confirm = () => true;
back.menu = { open: true, id: 'a2' };
await back.takeBackFromMenu(false);
assert.deepEqual(takes[1], ['/web/take-back', { id: 'a2', again: false }]);
console.log('PASS taking back its latest reply from its menu: only the latest and when done, delete asks first, again shows the dots');


// The computer layout (app.css from WIDE_SCREEN up, in a browser or the DSH panel): a line under each name in the
// sidebar, the sidebar folded away and back, and the resident's own card. Below that width it stays the phone's drawer.
const css = readFileSync('public/app.css', 'utf8');
assert.ok(css.includes('@media (min-width: 920px)') && code.includes("var WIDE_SCREEN = '(min-width: 920px)'"), 'the script and the style sheet change layout at the same width');
for (const part of ['class="rail-head"', 'class="rail-current"', '@click="showChat()"', '@click="foldRail()"', '@click="openRail()"', 'class="ident"', 'class="top-tools"', 'x-text="residentSub(r)"', 'x-text="groupSub(g)"']) {
  assert.ok(html.includes(part), `the page has ${part}`);
}
assert.match(css, /\.rail-head, \.rail-current, \.rail-foot, \.rail-item \.sub \{ display: none; \}/, 'the sidebar\'s extras are hidden on a phone');
assert.match(css, /\.ident, \.top-tools \{ display: contents; \}/, 'the phone\'s top bar keeps its one row');
const wide = vm.runInContext('testPage()', context);
wide.scrollSoon = () => {};
wide.resident = 'default';
wide.residents.list = [{ id: 'default', name: '住户', avatar: null, saidAt: 5 }, { id: 'b', name: 'B', avatar: null, saidAt: 9 }, { id: 'c', name: 'C', avatar: null, saidAt: 0 }];
wide.residents.seen = { default: 5, b: 1, c: 0 };
assert.equal(wide.residentSub(wide.residents.list[1]), '有新消息');
assert.equal(wide.residentSub(wide.residents.list[2]), '还没说过话');
wide.residents.seen.b = 9;
assert.match(wide.residentSub(wide.residents.list[1]), /^上次说话 \d/);
assert.equal(wide.groupSub({ members: ['default', 'b'] }), '2 个住户的群聊');
assert.equal(wide.groupSub({}), '群聊');
context.matchMedia = () => ({ matches: false });
wide.railFolded = true;
wide.openRail();
assert.deepEqual([wide.residents.open, wide.railFolded], [true, true], 'on a phone the button opens the drawer');
context.matchMedia = () => ({ matches: true });
wide.residents.open = false;
wide.railFolded = false;
wide.foldRail();
assert.equal(wide.railFolded, true, 'folded away');
wide.openRail();
assert.deepEqual([wide.residents.open, wide.railFolded], [false, false], 'on a wide screen the button brings the sidebar back');
wide.view = 'search';
wide.showChat();
assert.equal(wide.view, 'chat', 'the card goes back to its chat');
let profiled = false;
wide.openProfile = () => { profiled = true; };
wide.showChat();
assert.equal(profiled, true, 'and from the chat it shows who it is');
delete context.matchMedia;
console.log('PASS the computer layout: a line under each name, the sidebar folds away and back (a drawer on a phone), the resident\'s card goes to its chat');
