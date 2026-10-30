// The web door's page (Alpine.js, vendored). The conversation is drawn here from /web/messages, as plain text bound
// with x-text: nothing the model or anyone else wrote is ever put into the page as HTML.
/* eslint-disable no-var */

function emptySiteDraft() {
  return { site: '', lines: [{ name: '', value: '' }] };
}
function emptyThread() {
  return { loaded: false, id: '', title: '', runs: 'local', status: 'done', tasks: [], lines: [], files: [], canSay: false };
}
function emptyFileView() {
  return { path: '', key: '', size: 0, busy: false, kind: '', text: '', url: '' };
}

// ---- recording a voice message: PCM from the microphone, made a 16 kHz WAV, which every speech model reads ----

function encodeWav(chunks, inRate, outRate) {
  var length = chunks.reduce(function (n, chunk) { return n + chunk.length; }, 0);
  var input = new Float32Array(length);
  var at = 0;
  chunks.forEach(function (chunk) { input.set(chunk, at); at += chunk.length; });
  var ratio = inRate / outRate;
  var count = Math.floor(input.length / ratio);
  var bytes = new DataView(new ArrayBuffer(44 + count * 2));
  var text = function (offset, s) { for (var i = 0; i < s.length; i++) bytes.setUint8(offset + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); bytes.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true); bytes.setUint32(24, outRate, true);
  bytes.setUint32(28, outRate * 2, true); bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true); text(36, 'data'); bytes.setUint32(40, count * 2, true);
  for (var i = 0; i < count; i++) {
    // Each output sample is the average of the input samples it stands for.
    var from = Math.floor(i * ratio);
    var to = Math.min(input.length, Math.floor((i + 1) * ratio));
    var sum = 0;
    for (var j = from; j < to; j++) sum += input[j];
    var value = Math.max(-1, Math.min(1, sum / Math.max(1, to - from)));
    bytes.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Uint8Array(bytes.buffer);
}

function base64Of(bytes) {
  var binary = '';
  for (var at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** A picture made small enough to send: its longer side at most `edge`, JPEG (PNG for the avatar). */
async function shrinkPicture(file, edge, square) {
  var bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    bitmap = await new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  var w = bitmap.width;
  var h = bitmap.height;
  var sx = 0;
  var sy = 0;
  if (square) {
    var side = Math.min(w, h);
    sx = (w - side) / 2;
    sy = (h - side) / 2;
    w = side;
    h = side;
  }
  var scale = Math.min(1, edge / Math.max(w, h));
  var canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(bitmap, sx, sy, w, h, 0, 0, canvas.width, canvas.height);
  var type = square ? 'image/png' : 'image/jpeg';
  var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, type, 0.86); });
  if (square && blob.size > 480 * 1024) blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.9); });
  return blob;
}

function urlBase64ToBytes(text) {
  var padded = (text + '==='.slice((text.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), function (c) { return c.charCodeAt(0); });
}

function resident() {
  var POLL_MS = 5000;
  var FAST_MS = 900;
  // A look that asks "anything new since this version?" reads nothing when nothing is; the whole conversation is
  // read again at least this often all the same.
  var FULL_MS = 2 * 60 * 1000;
  // How often the sidebar looks whether another resident said something.
  var RESIDENTS_MS = 60 * 1000;
  var PERSONA_MAX = 30000;
  var RESULTS_MAX = 60;
  // A model list longer than this is not browsed, only searched: it is the upstream's whole catalog, not a chosen list.
  var BROWSE_MAX = 150;
  var RECORD_MAX_SECONDS = 60;
  // Shown first in the picker, under the ones used recently.
  var FAVORITES = ['anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-fable-5.1', 'anthropic/claude-haiku-5.5', '@cf/zai-org/glm-4.7-flash'];
  // The settings: a list of sections, each opened on its own. A field marked `more` waits behind 更多设置. `labels`
  // names a choice in words; `helps`, `defs` and `picks` depend on the voice provider picked. The long `help` sits
  // behind a question mark next to each setting. Defaults are the code's (README, 设置).
  var ON_OFF = { on: '开', off: '关' };
  var CONFIG_GROUPS = [
    { id: 'aelios', title: '长期记忆', hint: '接上 Aelios，它就记得旧事。', fields: [
      { key: 'AELIOS_URL', label: '地址', placeholder: 'https://….workers.dev',
        help: '填了地址和 key，聊天就从 Aelios 过：它记得旧事，模型和 key 也用 Aelios 那边配好的。不填就没有长期记忆。' },
      { key: 'AELIOS_API_KEY', label: 'key', help: 'Aelios 的 CHATBOX_API_KEY（IM_API_KEY、MEMORY_MCP_API_KEY 也行）。' },
      { key: 'AELIOS_IDENTITY', label: '身份', help: 'Aelios 里给住户建的身份，用的模型要在它的主模型里。', def: '这把 key 的第一个身份', more: true },
      { key: 'AELIOS_NAMESPACE', label: '记忆空间', help: '记忆工具、开机包、交接信用哪个空间，跟身份在 Aelios 里的设置对上。', def: 'default', more: true }
    ] },
    { id: 'im', title: '聊天渠道', hint: '网页一直在。接上的渠道，在哪儿说的这里都看得到。', fields: [
      { key: 'TG_BOT_TOKEN', door: 'telegram', label: 'bot token', placeholder: '123456789:AA…',
        help: '在 Telegram 里找 @BotFather，发 /newbot 建一个 bot，把它给的 token 填在这里。保存后住户自己接好，bot 左下角的菜单按钮也会打开这个网页。' },
      { key: 'TG_ALLOWED', label: '谁能在 Telegram 上跟它说话', help: '@用户名或 chat id，逗号隔开。空着谁都不回。', placeholder: '@your_name' },
      { key: 'WECOM_ALLOWED', door: 'wecom', label: '谁能在企业微信上跟它说话', help: '成员的账号（通讯录里点开成员看「账号」），逗号隔开。空着谁都不回；有人被挡下，上面会显示那个账号。', placeholder: 'ZhangSan' },
      { key: 'WECOM_CORP_ID', label: '企业 ID', help: '管理后台「我的企业」页面最下面。', placeholder: 'ww…' },
      { key: 'WECOM_AGENT_ID', label: 'AgentId', help: '应用管理里点开这个自建应用就能看到。' },
      { key: 'WECOM_SECRET', label: 'Secret', help: '同一页，点「查看」，它会发到企业微信里。' },
      { key: 'WECOM_RELAY_URL', label: '转发地址', help: '装了 relay/wecom 的那台机器经 Cloudflare Tunnel 出来的网址。企业微信只认固定 IP 发来的请求，所以回消息要经过它。', placeholder: 'https://wecom-relay.…' },
      { key: 'WECOM_RELAY_KEY', label: '转发钥匙', help: '在转发机上运行 sudo sed -n \'s/^WECOM_RELAY_KEY=//p\' /etc/wecom-relay/env 看到的那串。别发在聊天里。' },
      { key: 'WECOM_TOKEN', label: 'Token', help: '应用页「接收消息」→「设置 API 接收」，点「随机获取」，复制过来。先在这里存好，再回企业微信点保存。' },
      { key: 'WECOM_AES_KEY', label: 'EncodingAESKey', help: '同一处，也点「随机获取」。' },
      { key: 'WECOM_STICKERS', label: '在企业微信上发表情包', def: 'off', labels: ON_OFF,
        help: '企业微信没有表情包这一类消息，也不放动图，打开后表情包在这里发成一张静图：动图挑最完整的那一帧，小图放大一倍。Telegram 包里的 WebP、WebM 贴纸要转发机装了 --media。关着时它在企业微信上不发表情，网页和 Telegram 照发。' },
      { key: 'WECOM_STICKER_BACKGROUND', label: '表情包垫的底色', def: '#EDEDED',
        picks: ['#EDEDED', '#FFFFFF', '#111111', 'none'],
        pickLabels: { '#EDEDED': '微信浅色', '#FFFFFF': '白', '#111111': '深色模式', none: '不垫' },
        help: '企业微信会把透明底变成黑底，所以发出去之前先把透明的地方垫成聊天背景的颜色，表情看着就像贴在聊天里。默认是微信浅色模式的聊天背景；在企业微信 App 里看、或者用深色模式的，换成对得上的颜色，也可以自己填，比如 #F5F5F5。' }
    ] },
    { id: 'heartbeat', title: '主动找你和闹钟', fields: [
      { key: 'CHECKIN_SCHEDULE', label: '主动找你', help: '比如 every day at 09:00、every weekday at 21:30、every 3 hours。空着就不主动找。', def: '不主动找' },
      { key: 'HEARTBEAT', label: '没动静时问它几次要不要找你', def: '3', picks: ['0', '1', '3', '5', '10'],
        help: '默认 55 分钟没人说话，当前携带的聊天还没达到写信门槛，或没有旧内容可收，就问它一句要不要找你，它不想就不发；之后每 55 分钟再问一次，问满这么多次或者你说话为止。每次都读热着的缓存，花的跟你发一条差不多，还把缓存续一小时。0 不问，最多 10。缓存选 5 分钟时不问。' },
      { key: 'QUIET_HOURS', label: '夜里别问', def: '00:00-08:00', hours: true,
        picks: ['00:00-08:00', '23:00-07:00', '01:00-09:00', 'off'],
        pickLabels: { '00:00-08:00': '0 点到 8 点', '23:00-07:00': '23 点到 7 点', '01:00-09:00': '1 点到 9 点', off: '关，夜里也问' },
        help: '这段时间里没动静也不问它要不要找你，这段沉默剩下的次数作废，你下次说话再从头数。按下面的时区算。你定的「主动找你」、它的闹钟和交接信照常。' },
      { key: 'ALARMS', label: '让它自己定闹钟', def: 'off', labels: ON_OFF,
        help: '它能自己定什么时候来找你：几分钟后、某个时间，或者每天几点，最多 10 个，重复的最密一小时一次。你一小时以上没说话时响，要把整段对话重新读一遍，大约顶 20 多条消息的钱。' },
      { key: 'TIME_ZONE', label: '时区', def: 'Asia/Singapore' }
    ] },
    { id: 'voice', title: '语音', fields: [
      { key: 'VOICE_PROVIDER', label: '发语音用哪家', def: 'off',
        labels: { off: '不发', elevenlabs: 'ElevenLabs', cartesia: 'Cartesia', openrouter: 'OpenRouter' },
        helps: { '': 'MiniMax、Gemini、OpenAI 这些选 OpenRouter。', off: 'MiniMax、Gemini、OpenAI 这些选 OpenRouter。' } },
      { key: 'VOICE_ID', label: '声音', needs: 'VOICE_PROVIDER',
        defs: { openrouter: '模型自己的' },
        helps: { elevenlabs: '从 ElevenLabs 的声音库复制 voice id，自己克隆的也行。', cartesia: '从 Cartesia 的声音库复制 voice id。', openrouter: '声音的名字，比如 Gemini 的 Kore。可以不填。' } },
      { key: 'VOICE_MODEL', label: '模型', needs: 'VOICE_PROVIDER',
        defs: { elevenlabs: 'eleven_v4', cartesia: 'sonic-3.6' },
        helps: { elevenlabs: 'v3、v4 会用 [laughs] 这类语气标记。', openrouter: '点一个，或填 OpenRouter 上的模型 id。笑、叹气的写法跟着模型走。' },
        picks: {
          openrouter: ['minimax/speech-2.8-hd', 'google/gemini-3.8-flash-tts', 'elevenlabs/eleven-v4', 'openai/gpt-4o-mini-tts-2025-12-15', 'fish-audio/s2.1-pro-free:free'],
          elevenlabs: ['eleven_v4', 'eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5'],
          cartesia: ['sonic-3.6', 'sonic-3.5']
        } },
      { key: 'VOICE_REPLY', label: '什么时候发语音', def: 'mirror', needs: 'VOICE_PROVIDER',
        labels: { mirror: '你发语音才回语音', always: '每条都发语音', tool: '它想发才发' } },
      { key: 'VOICE_API_KEY', label: 'key', needs: 'VOICE_PROVIDER',
        help: 'AI Gateway 的 Provider Keys 里存了这一家的 key（别名 default）就不用填。两边都没有时，Cloudflare 可能从 Gateway 的预付额度里扣。' },
      { key: 'VOICE_BASE_URL', label: '直连地址', help: '一般不填。填了就不走 AI Gateway，key 要填在上面。', needs: 'VOICE_PROVIDER', more: true }
    ] },
    { id: 'web', title: '搜网和读网页', fields: [
      { key: 'WEB_SEARCH', label: '搜网', def: 'on', help: '先用你自己的搜索 key（在「更多设置」里填），都没有就用 Cloudflare 的，按次扣 Gateway 额度。',
        labels: { on: '开', off: '关', ceramic: 'Ceramic', exa: 'Exa', linkup: 'Linkup' } },
      { key: 'WEB_FETCH', label: '读网页', def: 'on', labels: ON_OFF },
      { key: 'WEB_LEARN', label: '搜到的知识存进 Aelios', help: '挑几条长期都对的存起来，下次聊到不用再搜。要接着 Aelios。', def: 'on', labels: ON_OFF },
      { key: 'TAVILY_API_KEY', label: 'Tavily key', help: '自己的搜索 key，有几个填几个，按 Tavily、Brave、Perplexity 的顺序用。', more: true },
      { key: 'BRAVE_API_KEY', label: 'Brave key', more: true },
      { key: 'PERPLEXITY_API_KEY', label: 'Perplexity key', more: true },
      { key: 'WEB_FETCH_MODEL', label: '压长网页用的模型', help: '主模型能填的 id 这里都能填。off 不压，只截断。', def: '@cf/qwen/qwen3-30b-a3b-fp8', more: true }
    ] },
    { id: 'thinking', title: '思考和交接信', hint: '聊够了门槛、又安静了一阵，它把旧聊天收进一封交接信。', fields: [
      { key: 'THINKING_EFFORT', label: 'Claude 想多久', help: 'low 最快最省，max 最久最贵。只管 Claude；换了以后第一句要重写一次缓存。', def: 'auto',
        labels: { auto: '模型默认' } },
      { key: 'CACHE_TTL', label: 'Claude 的缓存留多久', help: '1 小时的写入贵一点，停一会儿再聊还能读缓存。', def: '1h', labels: { '1h': '1 小时', '5m': '5 分钟' } },
      { key: 'LETTER_TOKEN_THRESHOLD', label: '写交接信的聊天 token 门槛', def: '30000',
        help: '自动写信要同时满足聊天达到 token 门槛、没人说话达到闲置时间（默认 55 分钟）。连续聊天即使超过门槛也不会立即写。写后固定保留最近约 8000 token 原始聊天，整轮问答不拆开；最近一轮本身超过 8000 时整轮保留；交接信、人设、工具定义另算。手动 /handoff 不受门槛限制，但也要有旧内容可收。\n\n只接受大于 8000 的整数，默认 30000，也可设为 50000。按当前携带的聊天估算，含旧交接信、工具调用和结果、图片，不含人设、工具定义和历史思考；不按累计聊天总量算。' },
      { key: 'LETTER_IDLE_MINUTES', label: '写信前要闲置多久（分钟）', help: '聊天达到门槛后，也要等这么久没人说话才自动写。最多比缓存时长少 1 分钟。off 只靠手动 /handoff。', def: '55（缓存 5m 时 4）', more: true }
    ] },
    { id: 'tasks', title: '后台帮忙', hint: '查资料、写东西这类活交给线程，做完回来告诉你。', fields: [
      { key: 'CLOUD_TASKS', label: '让它后台帮忙', def: 'off', labels: ON_OFF, help: '打开就能用，线程跑在住户自己这里，不能跑代码。' },
      { key: 'CLOUD_TASK_GITHUB_TOKEN', label: 'GitHub token', needs: 'CLOUD_TASKS', help: '可不填。填了能跑代码、开 PR，仓库住户自己建。' },
      { key: 'CLOUD_TASK_URL', label: 'claude.ai 触发网址', needs: 'CLOUD_TASKS', help: '可不填。有 Claude 订阅时接，走订阅干活。', placeholder: 'https://api.anthropic.com/v1/claude_code/routines/trig_…/fire' },
      { key: 'CLOUD_TASK_TOKEN', label: 'claude.ai 的 token', needs: 'CLOUD_TASKS', help: '跟上面的网址配对。' },
      { key: 'CLOUD_TASK_MODEL', label: '线程用哪个模型', needs: 'CLOUD_TASKS',
        help: '留空用 Workers AI 的 glm-4.7-flash，每天有免费额度。',
        picks: ['anthropic/claude-haiku-5.5', 'anthropic/claude-sonnet-5.5'],
        pickLabels: { 'anthropic/claude-haiku-5.5': 'Claude Haiku（示例）', 'anthropic/claude-sonnet-5.5': 'Claude Sonnet（示例）' } }
    ] },
    { id: 'custom', title: '供应商', hint: '接了 Aelios，聊天的模型和 key 在 Aelios 后台配；这里管住户自己往外发的请求。', fields: [
      { key: 'AI_GATEWAY_ID', label: 'AI Gateway 的名字', def: 'default',
        help: '搜网、语音，和没接 Aelios 时的模型都走这个 Gateway，Provider Keys 里存的 key 也只在它里面找。留空就是 default。' },
      { key: 'CUSTOM_BASE_URL', label: '中转地址', help: '没接 Aelios 时，模型填 custom/模型名 就走这个地址，中转、OpenRouter 都行。写到 /v1 为止。', placeholder: 'https://…/v1' },
      { key: 'CUSTOM_API_KEY', label: '中转 key' },
      { key: 'CUSTOM_FORMAT', label: '中转格式', def: 'openai', labels: { openai: 'OpenAI', anthropic: 'Anthropic（带缓存）' } },
      { key: 'CLAUDE_CODE_OAUTH_TOKEN', label: 'Claude 订阅的 setup token',
        help: '模型填 claude-code/模型名（比如 claude-code/claude-opus-5-5）就用你自己的 Claude 订阅聊，工具照常能用。在电脑上跑 claude setup-token，把出来那串填这里。还要一台装了 Claude 盒子的机器，见 docs/claude-box.md（Google Cloud 的免费小机就行）。' },
      { key: 'CLAUDE_BOX_URL', label: 'Claude 盒子地址', help: '装了 claude-box 的那台机器经 Cloudflare Tunnel 出来的网址。', placeholder: 'https://claude-box.…' },
      { key: 'CLAUDE_BOX_KEY', label: 'Claude 盒子钥匙', help: '装盒子时生成的那串：Google Cloud 上跑 bash gcp.sh --show-key 看，自己的机器上跑 sudo sed -n \'s/^BOX_KEY=//p\' /etc/claude-box/env 看。别发在聊天里。' }
    ] },
    { id: 'push', title: '通知', fields: [
      { key: 'WEB_PUSH', label: '推什么', def: 'on', labels: { on: '没发到别处的', always: '都推', off: '不推' },
        help: '「没发到别处的」：它主动找你、线程做完、闹钟响了，没发到 Telegram 或企业微信的推过来；你在网页上说了话又走开，它的回复也推过来。「都推」：发到 Telegram 或企业微信的主动消息也推。' }
    ] },
    { id: 'identity', title: '名字', fields: [
      { key: 'RESIDENT_NAME', label: '名字', def: '住户' }
    ] }
  ];
  // The rows of the settings page, in order: the groups above, and the sections with their own cards.
  var CONFIG_MENU = ['aelios', 'im', 'push', 'voice', 'stickers', 'web', 'tasks', 'mcp', 'heartbeat', 'thinking', 'custom'].map(function (id) {
    var group = CONFIG_GROUPS.find(function (g) { return g.id === id; });
    return { id: id, title: group ? group.title : { stickers: '表情包', mcp: '别的工具（MCP）' }[id] };
  });
  // The settings page's list, in groups.
  var SETTINGS_HOME = [
    { title: '连接', rows: ['aelios', 'im', 'push'] },
    { title: '它会做的', rows: ['voice', 'stickers', 'web', 'tasks', 'mcp'] },
    { title: '节奏', rows: ['heartbeat'] },
    { title: '其他', rows: ['thinking', 'custom'] }
  ];
  // A chat door's settings, as steps: one done is folded away; the first one not done is open.
  var DOOR_STEPS = {
    telegram: [
      { id: 'bot', title: '建一个 bot', keys: ['TG_BOT_TOKEN'] },
      { id: 'who', title: '谁能跟它说话', keys: ['TG_ALLOWED'] }
    ],
    wecom: [
      { id: 'app', title: '企业和应用', keys: ['WECOM_CORP_ID', 'WECOM_AGENT_ID', 'WECOM_SECRET'] },
      { id: 'relay', title: '转发机', keys: ['WECOM_RELAY_URL', 'WECOM_RELAY_KEY'] },
      { id: 'receive', title: '接收消息', keys: ['WECOM_TOKEN', 'WECOM_AES_KEY'], url: true },
      { id: 'who', title: '谁能跟它说话', keys: ['WECOM_ALLOWED'] },
      // Not a step to finish: settings that already have a default.
      { id: 'stickers', title: '在企业微信上发表情包', keys: ['WECOM_STICKERS', 'WECOM_STICKER_BACKGROUND'], extra: true }
    ]
  };
  // How a cloud task stands, in words (cloud-tasks.ts TaskStatus).
  // chosen and settled: a task that waited for her and no longer does (stateOf).
  var TASK_STATUS = { sent: '派出去了', working: '在干活', done: '做完了', failed: '没做成', needs_you: '等你拍板', quiet: '没回音', chosen: '拍板了', settled: '处理过了' };
  // A tool call in a few words (its name when it is none of these).
  var TOOL_WORDS = {
    memory_recall: '翻了记忆', memory_remember: '记下了', memory_notebook: '翻了小本本', memory_forget: '忘掉了', memory_keep_moment: '存了一刻',
    web_search: '搜了网', web_fetch: '读了网页', make_sticker: '画了表情包', send_sticker: '发了表情包', send_voice: '发了语音', cloud_task: '交给线程',
    set_alarm: '定了闹钟', list_alarms: '看了闹钟', cancel_alarm: '取消了闹钟', mcp_connect: '接了工具', edit_persona: '改了人设'
  };
  var USAGE_SPANS = [{ key: 'today', label: '今天' }, { key: 'week', label: '7 天' }, { key: 'month', label: '30 天' }];

  function readKey() { try { return localStorage.getItem('resident.key') || ''; } catch (e) { return ''; } }
  function writeKey(value) { try { value ? localStorage.setItem('resident.key', value) : localStorage.removeItem('resident.key'); } catch (e) {} }
  function remember(name, value) { try { localStorage.setItem(name, value); } catch (e) {} }
  function recall(name) { try { return localStorage.getItem(name) || ''; } catch (e) { return ''; } }
  // Which resident the page is on (src/residents.ts): ?r=<id> (a notification, another bot's Mini App), else the one
  // last opened on this device. "default" is the first one.
  var RESIDENT_ID = /^[a-z][a-z0-9-]{0,23}$/;
  function residentFromUrl() { try { var id = new URLSearchParams(location.search).get('r') || ''; return RESIDENT_ID.test(id) ? id : ''; } catch (e) { return ''; } }
  // Text as the search compares it (chat-search.ts): each letter lowercased on its own, the same length as the text.
  function foldText(text) {
    var out = '';
    for (var c of text) { var low = c.toLowerCase(); out += c.charCodeAt(0) > 0x7f && low.charCodeAt(0) <= 0x7f ? c : low; }
    return out;
  }
  // The search page's state: what was asked, the hits so far, where the next page starts and the hit opened.
  function freshSearch() { return { q: '', asked: '', busy: false, done: false, error: '', results: [], next: null, open: '', around: {} }; }
  function seenOf() { try { return JSON.parse(localStorage.getItem('resident.seen') || '{}') || {}; } catch (e) { return {}; } }
  // The same rule as Telegram: a blank line starts a new bubble, except inside a fenced code block.
  function bubbleTexts(text) {
    var parts = [];
    var now = [];
    var fence = null;
    String(text || '').split('\n').forEach(function (line) {
      var mark = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (mark && (!fence || mark[1].charAt(0) === fence.charAt(0) && mark[1].length >= fence.length)) fence = fence ? null : mark[1];
      if (!fence && !line.trim()) {
        if (now.join('').trim()) parts.push(now.join('\n').trim());
        now = [];
      } else now.push(line);
    });
    if (now.join('').trim()) parts.push(now.join('\n').trim());
    return parts;
  }
  function parsed(text) { try { return JSON.parse(text); } catch (e) { return null; } }
  function dayKey(at) { var d = new Date(at); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }

  // Outside Alpine's reactive state: the SDK, timers, the recorder and the player.
  var telegram = null;
  var threadTimer = 0;
  var pollTimer = 0;
  var residentsTimer = 0;
  var holdTimer = 0;
  var recorder = null;
  var player = null;
  var mediaUrls = {};
  // The version of the conversation the page has (GET /web/messages?since=), and when it last read all of it.
  var seenRev = '';
  var fullAt = 0;
  var picLoading = {};
  // Her lines from the server that already took the place of one sent from here.
  var settled = {};
  var seq = 0;
  // A thread's files the page shows as pictures; anything else that reads as text shows as text.
  var IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
  var extOf = function (path) { var m = String(path).match(/\.([A-Za-z0-9]+)$/); return m ? m[1].toLowerCase() : ''; };

  return Object.assign({
    key: readKey(),
    miniApp: false,
    miniToken: '',
    miniExpires: 0,
    keyInput: '',
    showKey: false,
    authed: false,
    loginError: '',
    aelios: false,
    identity: { name: '住户', avatar: null },
    // the residents in the sidebar, and which one this page is on
    resident: residentFromUrl() || 'default',
    residents: { list: [], max: 8, open: false, seen: seenOf(), add: { open: false, id: '', name: '', busy: false, error: '' }, busy: false },
    themePref: recall('resident.theme') || 'auto',
    theme: (typeof document !== 'undefined' && document.documentElement.dataset.theme) || 'dark',
    view: 'chat',
    toast: '',
    PERSONA_MAX: PERSONA_MAX,
    USAGE_SPANS: USAGE_SPANS,
    CONFIG_GROUPS: CONFIG_GROUPS,
    CONFIG_MENU: CONFIG_MENU,
    SETTINGS_HOME: SETTINGS_HOME,
    TASK_STATUS: TASK_STATUS,

    // the conversation
    lines: [],
    outbox: [],
    loaded: false,
    sending: 0,
    takingBack: false,
    pinned: {},
    openBusy: {},
    openTool: {},
    openLetter: {},
    picUrls: {},
    playing: '',
    audioBusy: '',
    nearBottom: true,
    unseen: 0,
    // the composer
    draft: '',
    pics: [],
    quote: null,
    panel: '',
    panelTab: 'tools',
    recording: null,
    stickerList: [],
    // sheets and menus
    menu: { open: false, id: '', role: '', text: '', x: 0, y: 0, voice: false, local: '' },
    lightbox: '',
    answer: { open: false, title: '', text: '', busy: false },
    alarmEdit: { open: false, id: '', kind: '', date: '', time: '', note: '', busy: false, error: '' },
    push: { supported: false, ios: false, standalone: false, on: false, busy: false, devices: 0, error: '', asked: recall('resident.push.ask') },
    nameEdit: { open: false, text: '', busy: false },
    avatarBusy: false,

    usage: { loaded: false, busy: false, totals: null, rows: [], more: false, keepDays: 90 },
    config: { fields: [], voice: { hears: null, gap: 'off', keyFrom: null }, telegram: { from: null, bot: null, here: false, error: null, lastError: null },
      wecom: { gap: 'off', allowed: [], relay: null, error: null, refused: null } },
    configSection: '',
    configMore: false,
    configDraft: {},
    configError: {},
    configBusy: '',
    helpOpen: {},
    stepOpen: {},
    letter: { canRetry: false, write: null, delivery: { pending: 0, failed: 0, blocked: 0, latest: null } },
    letterBusy: '',
    letterError: '',
    mcp: { servers: [] },
    mcpDraft: { name: '', url: '', key: '' },
    mcpBusy: '',
    mcpError: '',
    sites: [],
    siteDraft: emptySiteDraft(),
    siteBusy: '',
    siteError: '',
    STICKER_META: { key: 'STICKERS', label: '发表情包', def: 'on' },
    // On the persona page, not in a settings section: whether it may change its own persona (edit_persona).
    PERSONA_EDIT_META: { key: 'PERSONA_EDIT', label: '让它自己改', def: 'off' },
    stickers: { on: true, packs: [], left: 0 },
    cloud: { on: false, configured: false, mode: 'off', origin: '', prompt: '', github: { on: false, repo: '', url: '', problem: '', tokenPage: '' }, today: 0, limit: 10, tasks: [], roles: [] },
    // The role being written: its name, how it works, and its model ('' the threads' own, '…' one written in own).
    roleEdit: null,
    roleBusy: false,
    roleError: '',
    threads: { loaded: false, on: false, threads: [] },
    search: freshSearch(),
    thread: emptyThread(),
    fileView: emptyFileView(),
    threadDraft: '',
    threadBusy: false,
    alarms: { on: false, limit: 10, alarms: [] },
    alarmBusy: '',
    alarmError: '',
    choosing: '',
    cloudBusy: false,
    cloudError: '',
    stickerBusy: '',
    stickerError: '',
    stickerSkipped: [],
    stickerLink: '',
    openPack: '',
    persona: { text: '', at: null, fallback: '', versions: [] },
    model: { model: '', at: null, fallback: '', recent: [], lastUsage: null, memoryOff: false },
    catalog: [],
    catalogUpdated: '',
    // Aelios' own model list (GET /web/models), the one the picker browses while Aelios is connected.
    aeliosModels: { loaded: false, items: [], curated: false, error: '' },
    picker: { open: false, q: '', active: 0, busy: '', error: '' },
    personaLoaded: false,
    personaDraft: '',
    savingPersona: false,

    get personaDirty() { return this.personaDraft.trim() !== this.persona.text; },

    async start() {
      var self = this;
      this.applyTheme();
      this.$nextTick(function () { self.watchStream(); });
      try {
        matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (self.themePref === 'auto') self.applyTheme(); });
      } catch (e) {}
      document.addEventListener('visibilitychange', function () {
        if (document.hidden || !self.authed) return;
        self.refresh(true).catch(function () {});
        if (!self.miniApp) self.loadResidents().catch(function () {});
        // Back from an MCP sign-in in another tab: show how it went.
        if (self.view === 'config') self.loadMcp().catch(function () {});
      });
      // A notification tapped while this page is open: the page goes to the resident it is from.
      if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (event) {
        var open = event.data && event.data.open;
        if (!open || self.miniApp) return;
        var id = '';
        try { id = new URL(open, location.origin).searchParams.get('r') || ''; } catch (e) {}
        id = RESIDENT_ID.test(id) ? id : 'default';
        // Not in yet: it opens on that resident once the key is entered.
        if (!self.authed) self.resident = id;
        else self.switchResident(id);
      });
      fetch('/models.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
        if (!data) return;
        self.catalog = data.models || [];
        self.catalogUpdated = data.updated || '';
      }).catch(function () {});
      var miniLaunch = /(?:^#|[&#])tgWebAppData=/.test(location.hash);
      this.miniApp = miniLaunch;
      // A Mini App is its own bot's resident; a page opened without ?r= goes back to the one last opened here.
      if (!miniLaunch && !residentFromUrl()) this.resident = RESIDENT_ID.test(recall('resident.current')) ? recall('resident.current') : 'default';
      var readyBridge = await Promise.race([window.telegramReady, new Promise(function (resolve) { setTimeout(resolve, 10000, false); })]);
      if (miniLaunch && !readyBridge) { this.loginError = 'Telegram 组件没加载出来，请关闭小窗后重新打开'; return; }
      var tg = window.Telegram && window.Telegram.WebApp;
      if (miniLaunch && (!tg || !tg.initData)) { this.loginError = '没有收到 Telegram 的身份信息，请关闭小窗后重新打开'; return; }
      if (tg && tg.initData) {
        this.miniApp = true;
        telegram = tg;
        this.key = '';
        tg.ready();
        tg.expand();
        var viewport = function () {
          var style = document.documentElement.style;
          if (tg.viewportHeight) style.setProperty('--app-height', tg.viewportHeight + 'px');
          style.setProperty('--tg-top', Math.max(tg.safeAreaInset && tg.safeAreaInset.top || 0, tg.contentSafeAreaInset && tg.contentSafeAreaInset.top || 0) + 'px');
          style.setProperty('--tg-bottom', Math.max(tg.safeAreaInset && tg.safeAreaInset.bottom || 0, tg.contentSafeAreaInset && tg.contentSafeAreaInset.bottom || 0) + 'px');
        };
        viewport();
        ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged'].forEach(function (event) { tg.onEvent(event, viewport); });
        tg.onEvent('activated', function () { if (self.authed) self.refresh().catch(function () {}); });
        this.syncTelegramTheme();
        if (tg.BackButton) tg.BackButton.onClick(function () { self.goBack(); });
        this.$watch('view', function () { self.syncTelegramBack(); });
        this.$watch('picker.open', function () { self.syncTelegramBack(); });
        await this.check('');
      } else {
        this.preparePush();
        if (this.key) await this.check(this.key);
      }
    },
    syncTelegramBack() {
      if (!telegram || !telegram.BackButton) return;
      if (this.view !== 'chat' || this.picker.open) telegram.BackButton.show(); else telegram.BackButton.hide();
    },
    syncTelegramTheme() {
      if (!telegram) return;
      var color = this.theme === 'dark' ? '#070a16' : '#F8F5EF';
      try { telegram.setHeaderColor(color); telegram.setBackgroundColor(color); if (telegram.isVersionAtLeast('7.10')) telegram.setBottomBarColor(color); } catch (error) {}
    },
    async miniSession(renew) {
      var headers = renew && this.miniToken ? { authorization: 'Bearer ' + this.miniToken } : { 'x-telegram-init-data': telegram.initData };
      var response = await fetch(this.residentPath('/web/session'), { method: 'POST', headers: headers });
      if (!response.ok) throw new Error('Telegram 身份已失效或不在白名单里，请关闭小窗后重新打开');
      var data = await response.json();
      this.miniToken = data.token;
      this.miniExpires = data.expiresAt;
    },
    async api(path, options) {
      var opts = options || {};
      // An answer for the resident the page was on before a switch is not shown on the new one.
      var on = this.resident;
      if (this.miniApp && (!this.miniToken || this.miniExpires - Date.now() < 3600000)) {
        try { await this.miniSession(Boolean(this.miniToken)); } catch (error) {
          try { await this.miniSession(false); } catch (failed) { this.authed = false; this.loginError = failed.message; throw failed; }
        }
      }
      var headers = this.miniApp ? { authorization: 'Bearer ' + this.miniToken } : { 'x-web-key': this.key };
      if (opts.body) headers['content-type'] = 'application/json';
      if (opts.raw) headers['content-type'] = opts.type || 'application/octet-stream';
      var payload = opts.raw || (opts.body ? JSON.stringify(opts.body) : undefined);
      path = this.residentPath(path);
      var response = await fetch(path, { method: opts.method || 'GET', headers: headers, body: payload });
      if (response.status === 401 && this.miniApp) {
        try {
          await this.miniSession(false);
          headers.authorization = 'Bearer ' + this.miniToken;
          response = await fetch(path, { method: opts.method || 'GET', headers: headers, body: payload });
        } catch (error) { this.authed = false; this.loginError = error.message; throw error; }
      }
      if (on !== this.resident) { var moved = new Error('已经换到别的住户了'); moved.moved = true; throw moved; }
      if (response.status === 401) { this.authed = false; this.loginError = this.miniApp ? '请关闭小窗后重新打开，或检查 Telegram 白名单' : '钥匙不对'; throw new Error(this.loginError); }
      if (!response.ok) {
        var problem = await response.json().catch(function () { return {}; });
        var failed = new Error(problem.error || '出错了（' + response.status + '）');
        failed.status = response.status;
        throw failed;
      }
      if (opts.blob) return response.blob();
      if (opts.bytes) return new Uint8Array(await response.arrayBuffer());
      return response.json();
    },
    async check(key) {
      this.key = key;
      try {
        var data = await this.api('/web/check');
        this.aelios = Boolean(data.aelios);
        this.identity = { name: data.name || '住户', avatar: data.avatar || null };
        this.lines = this.took(await this.api('/web/messages')) || [];
        this.authed = true;
        this.loaded = true;
        if (!this.miniApp) writeKey(key);
        this.loadPersona().catch(function () {});
        this.loadModel().catch(function () {});
        this.loadTasks().catch(function () {});
        this.loadAlarms().catch(function () {});
        this.loadPushState().catch(function () {});
        if (!this.miniApp) { remember('resident.current', this.resident); this.loadResidents().catch(function () {}); }
        this.scrollSoon(true);
        this.poll();
      } catch (error) {
        if (error.moved) return;
        // A resident deleted since this device last opened it: back to the first one.
        if (error.status === 404 && this.resident !== 'default' && !this.miniApp) {
          this.resident = 'default';
          remember('resident.current', 'default');
          history.replaceState(null, '', '/');
          return this.check(key);
        }
        this.authed = false;
        this.loginError = error.message;
      }
    },
    login() {
      this.loginError = '';
      if (this.keyInput.trim()) this.check(this.keyInput.trim());
    },
    // ---- the residents (src/residents.ts): one avatar each in the sidebar ----
    residentPrefix() {
      return this.resident === 'default' ? '' : '/r/' + this.resident;
    },
    // Another resident's API is under /r/<id>; the list of residents is the same for all of them.
    residentPath(path) {
      return this.resident !== 'default' && path.indexOf('/web/') === 0 && path.indexOf('/web/residents') !== 0 ? '/r/' + this.resident + path : path;
    },
    stickerUrl(key) {
      return this.residentPrefix() + '/stickers/' + key;
    },
    initialOf(name) {
      return Array.from(String(name || '').trim())[0] || '住';
    },
    async loadResidents() {
      var self = this;
      clearTimeout(residentsTimer);
      var data = await this.api('/web/residents');
      var list = data.residents || [];
      this.residents.list = list;
      this.residents.max = data.max || 8;
      // One first seen here starts without a dot; the one on the page is seen.
      list.forEach(function (r) { if (!(r.id in self.residents.seen) || r.id === self.resident) self.residents.seen[r.id] = r.saidAt; });
      remember('resident.seen', JSON.stringify(this.residents.seen));
      if (!list.some(function (r) { return r.id === self.resident; })) return this.switchResident('default');
      this.loadGroups().catch(function () {});
      if (list.length < 2) return;
      residentsTimer = setTimeout(function tick() {
        if (!self.authed) return;
        if (document.hidden) { residentsTimer = setTimeout(tick, RESIDENTS_MS); return; }
        self.loadResidents().catch(function () { residentsTimer = setTimeout(tick, RESIDENTS_MS); });
      }, RESIDENTS_MS);
    },
    // Another resident said something since this device last had it open.
    residentDot(r) {
      return r.id !== this.resident && r.saidAt > (this.residents.seen[r.id] || 0);
    },
    anyResidentDot() {
      var self = this;
      return this.residents.list.some(function (r) { return self.residentDot(r); });
    },
    async switchResident(id) {
      this.residents.open = false;
      if (id === this.resident && this.view === 'group') { this.view = 'chat'; this.scrollSoon(true); }
      if (id === this.resident || !this.authed) return;
      clearTimeout(pollTimer);
      this.resident = id;
      remember('resident.current', id);
      try { history.replaceState(null, '', id === 'default' ? '/' : '/?r=' + id); } catch (e) {}
      var known = this.residents.list.find(function (r) { return r.id === id; });
      if (known) this.residents.seen[id] = known.saidAt;
      remember('resident.seen', JSON.stringify(this.residents.seen));
      // Everything on the page was the last resident's.
      seenRev = '';
      fullAt = 0;
      settled = {};
      picLoading = {};
      this.identity = known ? { name: known.name, avatar: known.avatar } : { name: '住户', avatar: null };
      this.lines = [];
      this.outbox = [];
      this.loaded = false;
      this.unseen = 0;
      this.view = 'chat';
      this.draft = '';
      this.pics = [];
      this.quote = null;
      this.panel = '';
      this.menu.open = false;
      this.picker.open = false;
      this.picUrls = {};
      this.stickerList = [];
      this.personaLoaded = false;
      this.persona = { text: '', at: null, fallback: '', versions: [] };
      this.model = { model: '', at: null, fallback: '', recent: [], lastUsage: null, memoryOff: false };
      this.aeliosModels = { loaded: false, items: [], curated: false, error: '' };
      this.usage = { loaded: false, busy: false, totals: null, rows: [], more: false, keepDays: 90 };
      this.config = { fields: [], voice: { hears: null, gap: 'off', keyFrom: null }, telegram: { from: null, bot: null, here: false, error: null, lastError: null },
        wecom: { gap: 'off', allowed: [], relay: null, error: null, refused: null } };
      this.configSection = '';
      this.configDraft = {};
      this.configError = {};
      this.mcp = { servers: [] };
      this.sites = [];
      this.search = freshSearch();
      this.stickers = { on: true, packs: [], left: 0 };
      this.cloud = { on: false, configured: false, mode: 'off', origin: '', prompt: '', github: { on: false, repo: '', url: '', problem: '', tokenPage: '' }, today: 0, limit: 10, tasks: [], roles: [] };
      this.roleEdit = null;
      this.threads = { loaded: false, on: false, threads: [] };
      this.thread = emptyThread();
      this.alarms = { on: false, limit: 10, alarms: [] };
      this.setLetter(null);
      await this.check(this.key);
    },
    openAddResident() {
      this.residents.open = false;
      this.residents.add = { open: true, id: '', name: '', busy: false, error: '' };
    },
    async addResident() {
      var add = this.residents.add;
      if (add.busy) return;
      var id = add.id.trim().toLowerCase();
      if (!RESIDENT_ID.test(id) || id === 'default') { add.error = '代号要小写英文字母开头，只用小写字母、数字和 -，最多 24 个'; return; }
      add.busy = true;
      add.error = '';
      try {
        var data = await this.api('/web/residents', { method: 'POST', body: { id: id, name: add.name.trim() } });
        this.residents.list = data.residents || [];
        this.residents.seen[id] = 0;
        add.open = false;
        await this.switchResident(id);
        this.loadResidents().catch(function () {});
      } catch (error) {
        add.error = error.message;
      } finally {
        add.busy = false;
      }
    },
    async removeResident() {
      var id = this.resident;
      if (id === 'default' || this.residents.busy) return;
      var typed = prompt('删掉「' + this.identity.name + '」？它的聊天、人设、设置、表情包和闹钟都删掉，找不回来；Aelios 里的记忆不动。\n确定就输入它的代号：' + id);
      if (typed === null) return;
      if (typed.trim() !== id) { this.notify('代号不对，没删'); return; }
      this.residents.busy = true;
      try {
        var data = await this.api('/web/residents/remove', { method: 'POST', body: { id: id } });
        this.residents.list = data.residents || [];
        delete this.residents.seen[id];
        await this.switchResident('default');
        this.notify('删好了');
      } catch (error) {
        this.notify(error.message);
        // Off the list already; what it kept is wiped a little later.
        if (error.status === 502) {
          delete this.residents.seen[id];
          await this.loadResidents().catch(function () {});
          await this.switchResident('default');
        }
      } finally {
        this.residents.busy = false;
      }
    },

    logout() {
      writeKey('');
      seenRev = '';
      fullAt = 0;
      this.key = '';
      this.miniToken = '';
      this.miniExpires = 0;
      if (this.miniApp && telegram) telegram.close();
      this.keyInput = '';
      this.authed = false;
      this.loaded = false;
      this.lines = [];
      this.outbox = [];
      this.view = 'chat';
      this.personaLoaded = false;
      this.config = { fields: [] };
      this.configDraft = {};
      this.setLetter(null);
      this.letterError = '';
      this.picker.open = false;
      this.residents.list = [];
      this.groups = [];
      this.search = freshSearch();
      clearTimeout(pollTimer);
      clearTimeout(residentsTimer);
    },

    // ---- the conversation, as rows ----
    rows() {
      var self = this;
      var out = [];
      var lastDay = '';
      var lastVia = null;
      // A thread's card shows once, under the newest line about it: sent under one reply, reported under a later one.
      var newest = {};
      this.lines.forEach(function (line) { (line.tasks || []).forEach(function (task) { newest[task.id] = line.id; }); });
      this.lines.forEach(function (line) {
        if (line.at) {
          var day = dayKey(line.at);
          if (day !== lastDay) {
            out.push({ key: 'day_' + line.id, type: 'day', text: self.dayText(line.at) });
            lastDay = day;
          }
        }
        if (line.kind === 'notice') { out.push({ key: line.id, type: 'notice', text: line.text }); return; }
        if (line.kind === 'letter') { out.push({ key: line.id, type: 'letter', line: line }); lastVia = null; return; }
        // A message it wrote without being asked says so once, above it.
        if (line.role === 'assistant' && (line.via === 'checkin' || line.via === 'task') && lastVia !== line.via) {
          out.push({ key: 'why_' + line.id, type: 'why', text: (line.via === 'task' ? '线程交回' : '主动找你') + (line.at ? ' · ' + self.clock(line.at) : '') });
        }
        lastVia = line.role === 'user' ? null : line.via;
        var cards = (line.tasks || []).filter(function (task) { return newest[task.id] === line.id; });
        out.push({ key: line.id, type: 'line', line: line, cards: cards });
      });
      this.outbox.forEach(function (item) { out.push({ key: item.tid, type: 'local', item: item }); });
      if (this.waiting()) out.push({ key: 'typing', type: 'typing' });
      return out;
    },
    // Waiting for a reply that has not started to show.
    waiting() {
      if (!this.sending) return false;
      if (this.outbox.some(function (item) { return item.state === 'sending'; })) return true;
      var lastUser = -1;
      for (var i = this.lines.length - 1; i >= 0; i--) if (this.lines[i].role === 'user') { lastUser = i; break; }
      return !this.lines.slice(lastUser + 1).some(function (line) { return line.role === 'assistant' && line.kind === 'chat'; });
    },
    replying() {
      return this.sending > 0 || this.lines.some(function (line) { return line.pending; });
    },
    // Its latest reply, once it is done, can be taken back from its menu: deleted, or answered again.
    takeBackable(line) {
      if (line.role !== 'assistant' || line.kind !== 'chat' || line.pending || this.takingBack || this.replying()) return false;
      var last = this.lines.filter(function (l) { return l.kind !== 'notice'; }).pop();
      return Boolean(last && last.id === line.id);
    },
    // A check-in or a thread's report answers no message of hers, so it can only be deleted.
    answersHer(line) {
      return line.via !== 'checkin' && line.via !== 'task';
    },
    async takeBack(line, again) {
      if (!again && !confirm('删掉这条？')) return;
      this.takingBack = true;
      if (again) {
        // The reply goes at once, and the dots show until the new one starts.
        var lastUser = this.lines.map(function (l) { return l.role; }).lastIndexOf('user');
        this.lines = this.lines.filter(function (l, i) { return i <= lastUser || l.kind !== 'chat'; });
        this.sending += 1;
        this.poll(true);
      }
      try {
        var result = await this.api('/web/take-back', { method: 'POST', body: { id: line.id, again: again } });
        if (again && result.status !== 'completed') throw new Error('没回出来（' + result.status + '），再点一次试试');
      } catch (error) {
        this.notify(error.message);
      } finally {
        if (again) this.sending -= 1;
        this.takingBack = false;
        await this.refresh(true).catch(function () {});
        this.poll(this.replying());
      }
    },
    bubblesOf(line) {
      var texts = line.role === 'assistant' ? bubbleTexts(line.text) : (String(line.text || '').trim() ? [line.text] : []);
      return texts.map(function (text, index) { return { text: text, first: index === 0, last: index === texts.length - 1 }; });
    },
    // What it was busy with in a reply: one dashed line, and what is behind it.
    busyOf(line) {
      var activity = line.activity || [];
      var thoughts = activity.filter(function (item) { return item.type === 'reasoning' && item.text; });
      var tools = activity.filter(function (item) { return item.type === 'tool'; });
      if (!thoughts.length && !tools.length) return null;
      var bits = [];
      if (thoughts.length) bits.push(line.pending && !tools.length ? '正在想…' : '想了一下');
      if (tools.length) bits.push('忙活了 ' + tools.length + ' 回' + (line.pending ? ' · 还在继续' : ''));
      var items = [];
      thoughts.forEach(function (item, index) { items.push({ key: 'r' + index, what: '想了一下', detail: item.text.replace(/\s+/g, ' ').slice(0, 80), state: '', body: [{ label: '', text: item.text }] }); });
      tools.forEach(function (item) {
        var input = parsed(item.input);
        var detail = input && typeof input === 'object' ? String(input.query || input.url || input.note || input.title || input.sticker || input.name || input.text || '') : String(item.input || '');
        var state = { 'output-available': '', 'output-error': '出错了', 'output-denied': '没执行', 'input-streaming': '准备中' }[item.state];
        var what = TOOL_WORDS[item.name] || (item.name.indexOf('mcp_') === 0 ? '用了工具 ' + item.name.slice(4) : item.name);
        items.push({ key: 't' + item.id, what: what, detail: detail.replace(/\s+/g, ' ').slice(0, 80), state: state === undefined ? '进行中' : state,
          body: [{ label: '参数', text: item.input || '（无）' }].concat(item.output !== undefined ? [{ label: '结果', text: item.output }] : []) });
      });
      return { label: bits.join(' · '), live: Boolean(line.pending), items: items };
    },
    // Pages it read in a reply, as cards to open.
    pagesOf(line) {
      var seen = {};
      return (line.activity || []).filter(function (item) { return item.type === 'tool' && item.name === 'web_fetch' && item.state === 'output-available'; }).map(function (item) {
        var input = parsed(item.input);
        var url = input && typeof input.url === 'string' ? input.url : '';
        var host = '';
        try { var parsedUrl = new URL(url); if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') return null; host = parsedUrl.host; } catch (e) { return null; }
        if (seen[url]) return null;
        seen[url] = true;
        var heading = String(item.output || '').split('\n').map(function (s) { return s.replace(/^#+\s*/, '').trim(); }).find(function (s) { return s && s.length < 120 && s.charAt(0) !== '{'; });
        return { url: url, host: host, title: heading || host };
      }).filter(Boolean).slice(0, 3);
    },
    // Alarms it set in a reply, as cards: still there, moved, or gone.
    alarmCardsOf(line) {
      var self = this;
      return (line.activity || []).filter(function (item) { return item.type === 'tool' && item.name === 'set_alarm' && item.state === 'output-available'; }).map(function (item) {
        var out = parsed(item.output);
        if (!out || !out.id) return null;
        var now = self.alarms.alarms.find(function (alarm) { return alarm.id === out.id; });
        return { id: out.id, note: out.note || '', rings: now ? now.next : out.rings, when: now ? now.when : (out.repeat ? '重复' : '一次'), alive: Boolean(now), alarm: now || null };
      }).filter(Boolean);
    },
    toggleBusy(id) {
      var next = Object.assign({}, this.openBusy);
      next[id] = !next[id];
      this.openBusy = next;
      this.resettle();
    },
    toggleTool(key) {
      var next = Object.assign({}, this.openTool);
      next[key] = !next[key];
      this.openTool = next;
      this.resettle();
    },
    toggleLetter(id) {
      var next = Object.assign({}, this.openLetter);
      next[id] = !next[id];
      this.openLetter = next;
      this.resettle();
    },
    // Only this resident's own sticker addresses (another resident's start with /r/<id>).
    stickersOf(line) {
      var prefix = this.residentPrefix();
      return (line.stickers || []).filter(function (sticker) {
        var url = String(sticker.url || '');
        return url.slice(0, prefix.length) === prefix && /^\/stickers\/[0-9a-f]{24}$/.test(url.slice(prefix.length));
      });
    },
    picsOf(line) {
      var list = [];
      for (var n = 0; n < Math.min(line.pictures || 0, 8); n++) list.push(n);
      return list;
    },
    // A picture of hers, read with the web key and shown from memory.
    picUrl(id, n) {
      var key = id + ':' + n;
      var url = this.picUrls[key];
      if (url !== undefined || picLoading[key]) return url || '';
      picLoading[key] = true;
      var self = this;
      this.api('/web/picture?id=' + encodeURIComponent(id) + '&n=' + n, { blob: true }).then(function (blob) {
        var next = Object.assign({}, self.picUrls);
        next[key] = URL.createObjectURL(blob);
        self.picUrls = next;
      }).catch(function () {
        var next = Object.assign({}, self.picUrls);
        next[key] = '';
        self.picUrls = next;
      });
      return '';
    },
    viaBadge(line) {
      return line.via === 'telegram' || line.via === 'wecom' ? this.viaLabel(line.via) : '';
    },
    voiceLen(voice) {
      if (!voice || !voice.seconds) return '';
      var s = Math.max(1, Math.round(voice.seconds));
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    },
    waveOf(voice) {
      var count = Math.max(10, Math.min(26, Math.round(((voice && voice.seconds) || 6) * 1.6)));
      var bars = [];
      for (var i = 0; i < count; i++) bars.push(6 + Math.round(16 * Math.abs(Math.sin(i * 1.7 + count))));
      return bars;
    },
    letterExcerpt(line) {
      return String(line.text || '').replace(/\s+/g, ' ').slice(0, 120);
    },
    dayText(at) {
      var date = new Date(at);
      var now = new Date();
      var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      if (date.toDateString() === now.toDateString()) return '今天';
      if (date.toDateString() === yesterday.toDateString()) return '昨天';
      return (date.getFullYear() === now.getFullYear() ? '' : date.getFullYear() + '年') + (date.getMonth() + 1) + '月' + date.getDate() + '日';
    },
    clock(at) {
      return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    },

    // ---- keeping up with the server ----
    poll(fast) {
      var self = this;
      clearTimeout(pollTimer);
      pollTimer = setTimeout(async function () {
        if (self.authed && !document.hidden) await self.refresh().catch(function () {});
        if (self.authed) self.poll(self.replying());
      }, fast ? FAST_MS : POLL_MS);
    },
    // What /web/messages gave: the lines, or null when nothing has changed since the version the page has.
    took(data) {
      if (data && data.rev) seenRev = data.rev;
      if (data && data.same) return null;
      fullAt = Date.now();
      return (data && data.data) || [];
    },
    async refresh(full) {
      if (!this.authed) return;
      var since = !full && seenRev && Date.now() - fullAt < FULL_MS ? seenRev : '';
      var lines = this.took(await this.api('/web/messages' + (since ? '?since=' + encodeURIComponent(since) : '')));
      if (!lines) return;
      var before = this.lines.length;
      var stick = this.isNearBottom();
      this.lines = lines;
      this.settleOutbox();
      if (lines.length > before && !stick) this.unseen += lines.length - before;
      // Something new was said, as when it comes back with what a thread did: the threads' count follows.
      if (lines.length !== before && this.cloud.on) this.loadTasks().catch(function () {});
      // At the bottom before the new lines came: follow them, however tall they are.
      if (stick) this.scrollSoon(true);
    },
    // A line typed here leaves the outbox once the server has its copy.
    // Each line of hers settles one item, oldest first, so two sent together do not both go with the first.
    settleOutbox() {
      var self = this;
      this.outbox = this.outbox.filter(function (item) {
        if (item.state !== 'sending') return true;
        var match = self.lines.find(function (line) {
          return line.role === 'user' && line.via === 'web' && item.known.indexOf(line.id) < 0 && !settled[line.id];
        });
        if (!match) return true;
        settled[match.id] = true;
        return false;
      });
    },
    isNearBottom() {
      var el = this.$refs && this.$refs.stream;
      return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    },
    onScroll() {
      this.nearBottom = this.isNearBottom();
      if (this.nearBottom) this.unseen = 0;
    },
    scrollSoon(force) {
      var self = this;
      if (force) this.nearBottom = true;
      this.$nextTick(function () {
        var el = self.$refs && self.$refs.stream;
        if (!el || !(force || self.isNearBottom())) return;
        el.scrollTop = el.scrollHeight;
        self.unseen = 0;
      });
    },
    // The conversation keeps to its bottom while she is there: when the keyboard, the + panel or a quote makes it
    // shorter, when it comes into view (Alpine shows it a frame later), and when a picture or sticker in it loads.
    watchStream() {
      var self = this;
      var el = this.$refs && this.$refs.stream;
      if (!el) return;
      var pin = function () { if (self.nearBottom && el.clientHeight) el.scrollTop = el.scrollHeight; };
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(pin).observe(el);
      el.addEventListener('load', pin, true);
      el.addEventListener('loadeddata', pin, true);
    },
    // Opening or closing something in the conversation moves its bottom without a scroll: say where she is now.
    resettle() {
      var self = this;
      this.$nextTick(function () { self.nearBottom = self.isNearBottom(); });
    },

    // ---- saying something ----
    canSend() {
      return Boolean(this.draft.trim() || this.pics.length);
    },
    sendDraft() {
      if (!this.canSend()) return;
      var payload = { text: this.draft.trim() };
      if (this.pics.length) payload.pictures = this.pics.map(function (pic) { return { data: pic.data }; });
      if (this.quote) payload.quote = this.quote.id;
      var shown = { text: this.draft.trim(), pics: this.pics.map(function (pic) { return pic.url; }), quote: this.quote };
      this.draft = '';
      this.pics = [];
      this.quote = null;
      this.panel = '';
      this.fit();
      return this.send(payload, shown);
    },
    async send(payload, shown) {
      var item = Object.assign({ tid: 'local_' + (++seq), at: Date.now(), state: 'sending', error: '', text: '', pics: [], quote: null, voice: null, sticker: null }, shown,
        { payload: payload, known: this.lines.map(function (line) { return line.id; }) });
      this.outbox.push(item);
      this.sending += 1;
      this.scrollSoon(true);
      this.poll(true);
      try {
        var result = await this.api('/web/say', { method: 'POST', body: payload });
        if (result.status === 'empty') this.dropLocal(item.tid);
        else if (result.status !== 'completed') throw new Error('这句没回出来（' + result.status + '），再发一次试试');
      } catch (error) {
        var still = this.outbox.find(function (o) { return o.tid === item.tid; });
        if (still) { still.state = 'failed'; still.error = error.message; }
        else this.notify(error.message);
      } finally {
        this.sending -= 1;
        await this.refresh().catch(function () {});
        this.loadModel().catch(function () {});
        if (payload.voice || this.alarms.on) this.loadAlarms().catch(function () {});
        this.loadTasks().catch(function () {});
        this.poll(this.replying());
      }
    },
    dropLocal(tid) {
      this.outbox = this.outbox.filter(function (item) { return item.tid !== tid; });
    },
    retry(item) {
      this.dropLocal(item.tid);
      var shown = { text: item.text, pics: item.pics, quote: item.quote, voice: item.voice, sticker: item.sticker };
      return this.send(item.payload, shown);
    },
    keydown(event) {
      // Enter sends with a keyboard; on a phone it starts a new line and the button sends.
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      if (!matchMedia('(pointer: fine)').matches) return;
      event.preventDefault();
      this.sendDraft();
    },
    fit() {
      var el = this.$refs && this.$refs.input;
      if (!el) return;
      this.$nextTick(function () {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.38) + 'px';
      });
    },
    // + opens what it can do, the smiley the stickers; the same button again closes it.
    togglePanel(tab) {
      tab = tab || 'tools';
      if (this.panel && this.panelTab === tab) { this.panel = ''; return; }
      this.panel = 'open';
      this.panelTab = tab || 'tools';
      if (this.panelTab === 'stickers') this.loadStickerList();
    },
    async loadStickerList() {
      try {
        var data = await this.api('/web/stickers');
        this.stickers = data;
        var list = [];
        (data.packs || []).forEach(function (pack) {
          if (!pack.enabled) return;
          pack.stickers.forEach(function (sticker) { list.push({ key: sticker.key, emoji: sticker.emoji, when: sticker.when, video: sticker.video }); });
        });
        this.stickerList = list;
      } catch (error) {
        this.notify(error.message);
      }
    },
    sendSticker(sticker) {
      this.panel = '';
      var payload = { sticker: sticker.key };
      if (this.quote) payload.quote = this.quote.id;
      var shown = { sticker: { url: this.stickerUrl(sticker.key), video: sticker.video }, quote: this.quote };
      this.quote = null;
      return this.send(payload, shown);
    },
    async addPhotos(event) {
      var files = Array.prototype.slice.call(event.target.files || []);
      event.target.value = '';
      this.panel = '';
      for (var i = 0; i < files.length && this.pics.length < 4; i++) {
        try {
          var file = files[i];
          var blob = file.type === 'image/gif' && file.size < 3.5 * 1024 * 1024 ? file : await shrinkPicture(file, 1568, false);
          var bytes = new Uint8Array(await blob.arrayBuffer());
          this.pics.push({ url: URL.createObjectURL(blob), data: base64Of(bytes) });
        } catch (error) {
          this.notify('这张图读不了');
        }
      }
      if (files.length > 4) this.notify('一次最多 4 张');
    },
    removePic(index) {
      this.pics.splice(index, 1);
    },
    // Words to start a message with, from the panel.
    prefill(text) {
      this.panel = '';
      this.draft = text;
      var el = this.$refs && this.$refs.input;
      this.$nextTick(function () { if (el) { el.focus(); el.setSelectionRange(text.length, text.length); } });
      this.fit();
    },

    // ---- a voice message ----
    async startRecord() {
      if (this.recording) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.notify('这个浏览器录不了音'); return; }
      var stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      } catch (error) {
        this.notify('没拿到麦克风：在浏览器设置里允许这个网页用麦克风');
        return;
      }
      var Context = window.AudioContext || window.webkitAudioContext;
      var context = new Context();
      var source = context.createMediaStreamSource(stream);
      var node = context.createScriptProcessor(4096, 1, 1);
      var chunks = [];
      node.onaudioprocess = function (event) { chunks.push(new Float32Array(event.inputBuffer.getChannelData(0))); };
      source.connect(node);
      node.connect(context.destination);
      var self = this;
      recorder = { stream: stream, context: context, source: source, node: node, chunks: chunks, start: Date.now(),
        tick: setInterval(function () {
          if (!self.recording) return;
          self.recording.seconds = (Date.now() - recorder.start) / 1000;
          if (self.recording.seconds >= RECORD_MAX_SECONDS) self.stopRecord(true);
        }, 250) };
      this.recording = { seconds: 0 };
    },
    async stopRecord(send) {
      if (!recorder) return;
      var r = recorder;
      recorder = null;
      clearInterval(r.tick);
      try { r.source.disconnect(); r.node.disconnect(); } catch (e) {}
      r.stream.getTracks().forEach(function (track) { track.stop(); });
      var seconds = (Date.now() - r.start) / 1000;
      var rate = r.context.sampleRate;
      r.context.close().catch(function () {});
      this.recording = null;
      if (!send) return;
      if (seconds < 0.8 || !r.chunks.length) { this.notify('太短了，按住多说一会儿'); return; }
      var wav = encodeWav(r.chunks, rate, 16000);
      var url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      var payload = { voice: { data: base64Of(wav) } };
      if (this.quote) payload.quote = this.quote.id;
      var shown = { voice: { url: url, seconds: seconds }, quote: this.quote };
      this.quote = null;
      this.send(payload, shown);
    },

    // ---- playing a voice ----
    async play(key, url) {
      var id = key || url;
      if (!player) player = new Audio();
      if (this.playing === id) { player.pause(); this.playing = ''; return; }
      var self = this;
      try {
        this.audioBusy = id;
        var src = url || mediaUrls[key];
        if (!src) {
          var blob = await this.api('/web/media?key=' + encodeURIComponent(key), { blob: true });
          src = mediaUrls[key] = URL.createObjectURL(blob);
        }
        player.pause();
        player.src = src;
        player.onended = function () { self.playing = ''; };
        player.onerror = function () { self.playing = ''; };
        await player.play();
        this.playing = id;
      } catch (error) {
        this.notify('放不出来：' + error.message);
        this.playing = '';
      } finally {
        this.audioBusy = '';
      }
    },
    async speak(id) {
      this.closeMenu();
      this.audioBusy = 'speak:' + id;
      try {
        var spoken = await this.api('/web/speak', { method: 'POST', body: { id: id } });
        await this.refresh().catch(function () {});
        this.audioBusy = '';
        await this.play(spoken.key);
      } catch (error) {
        this.notify(error.message);
      } finally {
        if (this.audioBusy === 'speak:' + id) this.audioBusy = '';
      }
    },

    // ---- holding a message: a small menu ----
    pressStart(event, line) {
      var self = this;
      var target = event.currentTarget;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(function () { self.openMenu({ currentTarget: target, preventDefault: function () {} }, line); }, 450);
    },
    pressEnd() {
      clearTimeout(holdTimer);
    },
    openMenu(event, line) {
      if (event.preventDefault) event.preventDefault();
      clearTimeout(holdTimer);
      var rect = event.currentTarget.getBoundingClientRect();
      var width = this.takeBackable(line) ? 340 : 280;
      var x = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      var y = rect.top - 64 < 70 ? rect.bottom + 8 : rect.top - 64;
      this.menu = { open: true, id: line.id, role: line.role, text: line.text || '', x: x, y: y, voice: Boolean(line.voice && line.voice.key), local: '' };
      try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) {}
    },
    closeMenu() {
      this.menu = { open: false, id: '', role: '', text: '', x: 0, y: 0, voice: false, local: '' };
    },
    menuLine() {
      return this.lines.find(function (l) { return l.id === this.menu.id; }, this);
    },
    // Only its latest reply's menu has 重新生成 and 删掉.
    menuTakesBack() {
      var line = this.menuLine();
      return Boolean(this.menu.open && line && this.takeBackable(line));
    },
    takeBackFromMenu(again) {
      var line = this.menuLine();
      this.closeMenu();
      if (line && this.takeBackable(line)) return this.takeBack(line, again);
    },
    quoteFromMenu() {
      var line = this.menuLine();
      if (line) this.quote = { id: line.id, who: line.role, text: String(line.text || (line.voice ? '[语音]' : line.pictures ? '[图片]' : '')).replace(/\s+/g, ' ').slice(0, 80) };
      this.closeMenu();
      var el = this.$refs && this.$refs.input;
      if (el && matchMedia('(pointer: fine)').matches) el.focus();
    },
    async copyFromMenu() {
      var text = this.menu.text;
      this.closeMenu();
      try { await navigator.clipboard.writeText(text); this.notify('复制好了'); } catch (e) { this.notify('复制不了'); }
    },
    async pinFromMenu() {
      var id = this.menu.id;
      var text = this.menu.text;
      this.closeMenu();
      if (!id || this.pinned[id]) return;
      try {
        var result = await this.api('/web/pin', { method: 'POST', body: { text: text } });
        if (!result.ok) throw new Error('没存上');
        var next = Object.assign({}, this.pinned);
        next[id] = true;
        this.pinned = next;
        this.notify('已存进珍贵');
      } catch (error) {
        this.notify(error.message);
      }
    },
    quoteName(who) {
      return who === 'assistant' ? this.identity.name : '你';
    },

    // ---- slash commands, as buttons ----
    async handoff() {
      this.panel = '';
      if (!confirm('现在把更早的聊天收进一封交接信？')) return;
      this.answer = { open: true, title: '交接信', text: '', busy: true };
      try {
        var result = await this.api('/web/command', { method: 'POST', body: { name: 'handoff' } });
        this.answer = { open: true, title: '交接信', text: result.text, busy: false };
        await this.refresh().catch(function () {});
        this.loadLetter().catch(function () {});
      } catch (error) {
        this.answer = { open: true, title: '交接信', text: error.message, busy: false };
      }
    },

    // ---- threads' cards in the chat ----
    async choose(task, choice) {
      if (this.choosing || task.chosen) return;
      this.choosing = task.id;
      // The card says what she picked at once; it goes back if the choice did not get through.
      task.chosen = choice;
      task.waiting = false;
      try {
        var done = this.api('/web/task/choose', { method: 'POST', body: { id: task.id, text: choice } });
        this.sending += 1;
        this.poll(true);
        await done;
        this.notify('告诉它了');
      } catch (error) {
        task.chosen = null;
        task.waiting = true;
        this.notify(error.message);
      } finally {
        this.sending = Math.max(0, this.sending - 1);
        this.choosing = '';
        await this.refresh().catch(function () {});
        this.loadTasks().catch(function () {});
        if (this.view === 'thread' && this.thread.id) this.loadThread(this.thread.id).catch(function () {});
      }
    },
    // A card that waits for her with nothing left to decide: it stops asking. The resident is not told.
    async settle(task) {
      if (this.choosing || !task || !task.waiting) return;
      this.choosing = task.id;
      // Every card of it in the chat stops asking at once (the one that sent it and the one that reports on it).
      var mark = function (waiting) {
        task.waiting = waiting;
        this.lines.forEach(function (line) { (line.tasks || []).forEach(function (t) { if (t.id === task.id) t.waiting = waiting; }); });
      }.bind(this);
      mark(false);
      try {
        await this.api('/web/task/settle', { method: 'POST', body: { id: task.id } });
        this.notify('不再等你了');
      } catch (error) {
        mark(true);
        this.notify(error.message);
      } finally {
        this.choosing = '';
        this.refresh().catch(function () {});
        this.loadTasks().catch(function () {});
        if (this.view === 'thread' && this.thread.id) this.loadThread(this.thread.id).catch(function () {});
      }
    },
    // How a task stands: one that waited for her and was dealt with (picked, put aside or carried on) asks no more.
    stateOf(task) {
      if (!task) return '';
      if (task.status !== 'needs_you' || task.waiting !== false) return task.status;
      return task.chosen ? 'chosen' : 'settled';
    },
    taskPill(status) {
      return { working: 'warn', sent: 'warn', needs_you: 'hot', done: 'ok', failed: 'bad', quiet: 'bad', chosen: 'ok' }[status] || '';
    },
    taskNote(task) {
      if (task.status === 'sent' || task.status === 'working') return task.progress || '派出去了，等它开工';
      return task.summary || task.progress || '';
    },
    // What a thread's card in the chat says: one or two lines, without the report's marks. The thread has it all.
    taskPreview(task) {
      var note = this.taskNote(task);
      return typeof markdownPlain === 'function' ? markdownPlain(note) : note;
    },
    taskLinks(task) {
      var self = this;
      var https = function (url) { return /^https:\/\//.test(url || ''); };
      return (https(task.sessionUrl) ? [{ url: task.sessionUrl, text: '打开会话' }] : [])
        .concat((task.links || []).filter(https).map(function (url) { return { url: url, text: self.linkText(url) }; }));
    },
    // Threads at work or waiting for her, counted as 线程 lists them.
    workingTasks() {
      if (typeof this.cloud.open === 'number') return this.cloud.open;
      return (this.cloud.tasks || []).filter(function (task) { return !task.test && (task.status === 'sent' || task.status === 'working' || task.waiting); }).length;
    },

    // ---- alarms: cards in the chat, and moving one ----
    editAlarm(alarm) {
      if (!alarm || !alarm.edit) return;
      this.alarmEdit = { open: true, id: alarm.id, kind: alarm.edit, date: alarm.date, time: alarm.time, note: alarm.note, busy: false, error: '' };
    },
    async saveAlarm() {
      var edit = this.alarmEdit;
      if (edit.busy) return;
      edit.busy = true;
      edit.error = '';
      try {
        this.alarms = await this.api('/web/alarms/edit', { method: 'POST', body: { id: edit.id, when: edit.kind === 'date' ? edit.date + ' ' + edit.time : edit.time } });
        this.alarmEdit.open = false;
        this.notify('改好了');
      } catch (error) {
        edit.error = error.message;
      } finally {
        edit.busy = false;
      }
    },

    // ---- the header ----
    statusText() {
      var pending = this.lines.find(function (line) { return line.pending; });
      if (this.replying()) return pending && pending.text ? '正在输入…' : '正在想…';
      var memory = !this.aelios ? '' : this.model.memoryOff ? '记不住' : '记得你';
      return this.shortName(this.currentModel()) + (memory ? ' · ' + memory : '');
    },

    // ---- model picker ----
    async loadModel() {
      this.model = await this.api('/web/model');
    },
    currentModel() { return this.model.model || this.model.fallback || ''; },
    // Violet: Workers AI. Coral: a vendor model through AI Gateway. A coral ring: your own provider (custom/…).
    dotFor(id) {
      if (!id || id.charAt(0) === '@' || id === 'fake') return '';
      return id.indexOf('custom/') === 0 ? 'own' : 'gateway';
    },
    tagFor(id) {
      if (id === 'fake') return '测试';
      if (this.aelios) return '从 Aelios 过';
      return { gateway: 'Gateway 额度', own: '中转', '': 'Workers AI' }[this.dotFor(id)];
    },
    markFor(item) {
      var id = item.id || '';
      if (id.charAt(0) === '@') return 'CF';
      if (id.indexOf('custom/') === 0) return '中';
      return (item.provider || id.split('/')[0] || '?').charAt(0).toUpperCase();
    },
    shortName(id) {
      if (!id) return '模型';
      var parts = id.split('/');
      return parts[parts.length - 1];
    },
    // The model name as Aelios takes it (the same rewrites as aeliosName in src/via-aelios.ts), so one model written two
    // ways (Cloudflare's anthropic/claude-opus-5.5, Aelios' anthropic/claude-opus-5-5) counts as one.
    canon(id) {
      if (id.indexOf('@cf/') === 0) return 'workers-ai/' + id;
      var anthropic = id.match(/^anthropic\/(.+)$/i);
      return anthropic ? 'anthropic/' + anthropic[1].replace(/\./g, '-') : id;
    },
    same(a, b) { return Boolean(a) && Boolean(b) && this.canon(a) === this.canon(b); },
    aeliosEntry(id) {
      var items = this.aeliosModels.items;
      for (var i = 0; i < items.length; i++) if (this.same(items[i].id, id)) return items[i];
      return null;
    },
    // A name and a line of description from the shipped catalog, when it knows the model.
    describe(item) {
      for (var i = 0; i < this.catalog.length; i++) {
        if (this.same(this.catalog[i].id, item.id)) return Object.assign({}, item, { name: this.catalog[i].name, desc: this.catalog[i].desc });
      }
      return item;
    },
    listed(model) {
      var item = { id: model.id, name: this.shortName(model.id), provider: model.owner || '', desc: '' };
      if (model.main !== undefined) item.main = model.main;
      return item;
    },
    entry(id) {
      var listed = this.aeliosEntry(id);
      var item = this.describe(listed ? this.listed(listed) : { id: id, name: this.shortName(id), provider: '', desc: '' });
      // The catalog may spell it another way; the picker keeps the spelling it was given.
      item.id = id;
      return item;
    },
    // Where the picker's browse list comes from: Aelios' own list once it is connected and has answered, else the catalog.
    pickerMode() {
      if (!this.aelios) return 'catalog';
      if (!this.aeliosModels.loaded) return 'loading';
      return this.aeliosModels.items.length ? 'aelios' : 'catalog';
    },
    pickerNote() {
      if (!this.aelios) return '';
      var list = this.aeliosModels;
      if (!list.loaded) return '正在取 Aelios 的模型清单…';
      if (list.error) return 'Aelios 的模型清单没取到（' + list.error + '），先用自带的目录。';
      if (!list.items.length) return '';
      if (list.curated) return '这是你在 Aelios 里存的模型清单。要加新的，去 Aelios 设置 → 供应商 → 模型清单，或者上面直接填完整 id。';
      if (list.items.length > BROWSE_MAX) return 'Aelios 上游一共 ' + list.items.length + ' 个模型，不一一列出，搜一下。想只看常用的，在 Aelios 设置 → 供应商 → 模型清单里选好。';
      return '';
    },
    async loadAeliosModels() {
      if (!this.aelios) return;
      try {
        var data = await this.api('/web/models');
        this.aeliosModels = { loaded: true, items: data.models || [], curated: Boolean(data.curated), error: data.error || '' };
      } catch (error) {
        this.aeliosModels = { loaded: true, items: [], curated: false, error: error.message };
      }
    },
    pickerGroups() {
      var self = this;
      var groups = [];
      var used = {};
      var index = 0;
      function group(title, items) {
        var fresh = items.filter(function (item) { return item && !used[self.canon(item.id)] && (used[self.canon(item.id)] = true); });
        if (!fresh.length) return;
        groups.push({ title: title, items: fresh.map(function (item) { return Object.assign({}, item, { index: index++ }); }) });
      }
      function byProvider(items, label) {
        var names = [];
        var by = {};
        items.forEach(function (item) {
          var name = label(item);
          if (!by[name]) { by[name] = []; names.push(name); }
          by[name].push(item);
        });
        names.forEach(function (name) { group(name, by[name]); });
      }
      var mode = this.pickerMode();
      var q = this.picker.q.trim().toLowerCase();
      if (!q) {
        group('正在用', [this.entry(this.currentModel())]);
        group('最近用过', (this.model.recent || []).map(function (id) { return self.entry(id); }));
        if (mode === 'aelios') {
          group('常用', FAVORITES.filter(function (id) { return self.aeliosEntry(id); }).map(function (id) { return self.entry(id); }));
          var list = this.aeliosModels;
          if (list.curated || list.items.length <= BROWSE_MAX) {
            byProvider(list.items.map(function (model) { return self.describe(self.listed(model)); }), function (item) { return item.provider || '其他'; });
          }
        } else if (mode === 'catalog') {
          group('常用', FAVORITES.map(function (id) { return self.entry(id); }));
          byProvider(this.catalog, function (item) { return item.hosted ? 'Workers AI · ' + item.provider : item.provider; });
        }
        return groups;
      }
      var words = q.split(/\s+/);
      // The same model is written with dots or dashes in its version; a search written either way finds it.
      var haystack = function (item) { return (item.id + ' ' + item.id.replace(/-/g, '.') + ' ' + item.name + ' ' + item.provider).toLowerCase(); };
      var recent = (this.model.recent || []).map(function (id) { return self.entry(id); });
      var pool = mode === 'aelios'
        ? this.aeliosModels.items.map(function (model) { return self.listed(model); }).concat(recent)
        : this.catalog.concat(recent);
      var hits = pool.filter(function (item) {
        var hay = haystack(item);
        return words.every(function (word) { return hay.indexOf(word) >= 0 || hay.indexOf(word.replace(/\./g, '-')) >= 0; });
      });
      function rank(item) {
        var id = item.id.toLowerCase();
        var name = item.name.toLowerCase();
        if (id === q || name === q) return 0;
        if (name.indexOf(q) === 0 || id.indexOf(q) === 0) return 1;
        return 2;
      }
      hits.sort(function (a, b) { return rank(a) - rank(b); });
      var raw = this.picker.q.trim();
      var exact = hits.some(function (item) { return self.same(item.id, raw); });
      if (!exact && /^\S+\/\S+$/.test(raw)) group('目录里没有', [{ id: raw, name: raw, provider: '', desc: '', custom: true }]);
      group('搜到的', hits.slice(0, RESULTS_MAX).map(function (item) { return mode === 'aelios' ? self.describe(item) : item; }));
      return groups;
    },
    flatPicker() {
      return this.pickerGroups().reduce(function (all, group) { return all.concat(group.items); }, []);
    },
    move(step) {
      var count = this.flatPicker().length;
      if (count) this.picker.active = (this.picker.active + step + count) % count;
      this.$nextTick(function () {
        var el = document.querySelector('.option.active');
        if (el) el.scrollIntoView({ block: 'nearest' });
      });
    },
    chooseActive() {
      var items = this.flatPicker();
      var item = items[this.picker.active] || items[0];
      if (item) this.chooseModel(item.id);
    },
    async openPicker() {
      this.panel = '';
      this.picker.q = '';
      this.picker.active = 0;
      this.picker.error = '';
      this.picker.open = true;
      this.$nextTick(function () { if (matchMedia('(pointer: fine)').matches) { var el = document.querySelector('.search input'); if (el) el.focus(); } });
      this.loadModel().catch(function () {});
      this.loadAeliosModels();
    },
    closePicker() {
      if (this.picker.busy) return;
      this.picker.open = false;
    },
    async chooseModel(id) {
      if (this.picker.busy) return;
      if (this.same(id, this.currentModel())) { this.picker.open = false; return; }
      this.picker.busy = id;
      this.picker.error = '';
      try {
        this.model = await this.api('/web/model', { method: 'POST', body: { text: id } });
        this.picker.open = false;
        this.notify('换好了，下一句开始用 ' + this.shortName(this.currentModel()));
        this.refresh().catch(function () {});
      } catch (error) {
        this.picker.error = error.message;
      } finally {
        this.picker.busy = '';
      }
    },
    optionSub(item) {
      var bits = [];
      if (this.same(item.id, this.currentModel())) bits.push('正在用');
      if (item.provider) bits.push(item.provider);
      if (item.desc) bits.push(item.desc);
      if (!bits.length) bits.push(item.id);
      return bits.join(' · ');
    },

    // ---- searching the conversation (src/chat-search.ts) ----
    openSearch() {
      this.view = 'search';
      var self = this;
      this.$nextTick(function () { if (self.$refs.searchInput) self.$refs.searchInput.focus(); });
    },
    async runSearch(more) {
      var search = this.search;
      var q = more ? search.asked : search.q.trim().replace(/\s+/g, ' ');
      if (!q || search.busy) return;
      search.busy = true;
      search.error = '';
      try {
        var data = await this.api('/web/search?q=' + encodeURIComponent(q) + (more && search.next ? '&before=' + search.next : ''));
        if (!more) { search.results = []; search.open = ''; search.around = {}; search.asked = q; }
        var seen = {};
        search.results.forEach(function (hit) { seen[hit.id] = true; });
        search.results = search.results.concat((data.results || []).filter(function (hit) { return !seen[hit.id]; }));
        search.next = data.next || null;
        search.done = true;
      } catch (error) {
        if (error.moved) return;
        search.error = error.message;
      } finally {
        search.busy = false;
      }
    },
    searchSummary() {
      var n = this.search.results.length;
      if (!n) return this.search.next ? '最近这一段没找到「' + this.search.asked + '」，可以接着往前翻。' : '没找到「' + this.search.asked + '」。';
      return '找到 ' + n + (this.search.next ? '+' : '') + ' 条带「' + this.search.asked + '」的，新的在前。点一条看前后。';
    },
    async toggleHit(hit) {
      var search = this.search;
      if (search.open === hit.id) { search.open = ''; return; }
      search.open = hit.id;
      if (search.around[hit.id]) return;
      try {
        var data = await this.api('/web/search/around?id=' + encodeURIComponent(hit.id));
        search.around[hit.id] = { lines: data.lines || [] };
      } catch (error) {
        if (error.moved) return;
        search.around[hit.id] = { error: error.message, lines: [] };
      }
    },
    // The words of a line, with what was searched for marked: as the search finds it, spaces and line breaks
    // between the words count as one, and letters match in either case (foldText, as in chat-search.ts).
    markedParts(text) {
      var q = this.search.asked;
      text = String(text || '');
      if (!q) return [{ text: text }];
      var pattern = new RegExp(foldText(q).split(' ').map(function (piece) { return piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('\\s+'), 'g');
      var folded = foldText(text);
      var parts = [];
      var from = 0;
      var found;
      while ((found = pattern.exec(folded))) {
        if (found.index > from) parts.push({ text: text.slice(from, found.index) });
        parts.push({ text: text.slice(found.index, found.index + found[0].length), hit: true });
        from = found.index + found[0].length;
      }
      if (from < text.length) parts.push({ text: text.slice(from) });
      return parts;
    },
    searchWhen(at) {
      if (!at) return '';
      var year = new Date(at).getFullYear();
      return (year === new Date().getFullYear() ? '' : year + '-') + this.fmt(at);
    },
    // Whether a message is in the chat as it is on the page now (older ones are folded into a letter there).
    inChat(id) {
      return this.lines.some(function (line) { return line.id === id; });
    },
    showInChat(id) {
      var self = this;
      // Off the bottom first: the conversation keeps to its bottom when it comes back into view (a frame later).
      this.nearBottom = false;
      this.view = 'chat';
      setTimeout(function () {
        var slot = document.querySelector('[data-line="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
        var el = slot && (slot.querySelector('.row') || slot.firstElementChild);
        if (!el) return;
        self.nearBottom = false;
        el.scrollIntoView({ block: 'center' });
        el.classList.add('found');
        setTimeout(function () { el.classList.remove('found'); }, 1800);
      }, 60);
    },

    // ---- moving between pages ----
    goBack() {
      if (this.picker.open) return this.closePicker();
      if (this.view === 'config') return this.configBack();
      if (this.view === 'thread') return this.openThreads();
      if (this.view === 'persona') return this.closeSettings();
      if (this.view === 'usage') { this.view = 'profile'; return; }
      if (this.view === 'file') this.closeFile();
      this.view = 'chat';
      this.scrollSoon(true);
    },
    backText() {
      if (this.view === 'config' && this.configSection) return '回到设置';
      if (this.view === 'thread') return '回到线程';
      if (this.view === 'persona' || this.view === 'usage') return '回去';
      return '回到聊天';
    },
    async openProfile() {
      this.view = 'profile';
      this.nameEdit.open = false;
      this.loadPersona().catch(function () {});
      this.loadModel().catch(function () {});
      this.loadAlarms().catch(function () {});
      this.loadTasks().catch(function () {});
      this.loadLetter().catch(function () {});
      try { this.config = await this.api('/web/config'); this.fillDrafts(); } catch (e) {}
      try { var usage = await this.api('/web/usage'); this.usage = { loaded: true, busy: false, totals: usage.totals, rows: usage.rows, more: usage.more, keepDays: usage.keepDays }; } catch (e) {}
    },
    memoryPill() {
      if (!this.aelios) return { text: '没接记忆', cls: '' };
      return this.model.memoryOff ? { text: '记不住', cls: 'warn' } : { text: '记得你', cls: 'ok' };
    },
    voicePill() {
      var voice = this.config.voice || {};
      if (voice.gap === 'off' || voice.gap === undefined) return '';
      return voice.gap ? '声音还差一步' : '会说话';
    },
    // The avatar: a square from the picture she picks, made 512 pixels.
    async pickAvatar(event) {
      var file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file || this.avatarBusy) return;
      this.avatarBusy = true;
      try {
        var blob = await shrinkPicture(file, 512, true);
        this.identity = await this.api('/web/avatar', { method: 'POST', raw: blob, type: blob.type });
        this.notify('头像换好了');
      } catch (error) {
        this.notify(error.message);
      } finally {
        this.avatarBusy = false;
      }
    },
    async removeAvatar() {
      if (!confirm('不用头像了？')) return;
      try { this.identity = await this.api('/web/avatar/remove', { method: 'POST', body: {} }); } catch (error) { this.notify(error.message); }
    },
    startName() {
      this.nameEdit = { open: true, text: this.identity.name, busy: false };
      this.$nextTick(function () { var el = document.querySelector('.name-edit input'); if (el) el.focus(); });
    },
    async saveName() {
      if (this.nameEdit.busy) return;
      var text = this.nameEdit.text.trim();
      this.nameEdit.busy = true;
      try {
        await this.api('/web/config', { method: 'POST', body: { key: 'RESIDENT_NAME', text: text === '住户' ? '' : text } });
        var data = await this.api('/web/check');
        this.identity = { name: data.name || '住户', avatar: data.avatar || null };
        this.nameEdit.open = false;
      } catch (error) {
        this.notify(error.message);
        this.nameEdit.busy = false;
      }
    },

    // ---- threads (线程): the work the resident handed out, each thread with its conversation and files ----
    async openThreads() {
      clearTimeout(threadTimer);
      this.closeFile();
      this.view = 'threads';
      try {
        var data = await this.api('/web/threads');
        this.threads = { loaded: true, on: Boolean(data.on), threads: data.threads || [] };
      } catch (error) {
        this.notify(error.message);
      }
    },
    async openThread(id) {
      if (!id) return;
      if (this.thread.id !== id) {
        this.thread = emptyThread();
        this.threadDraft = '';
        this.closeFile();
      }
      this.view = 'thread';
      await this.loadThread(id);
    },
    async loadThread(id) {
      var self = this;
      clearTimeout(threadTimer);
      try {
        var data = await this.api('/web/thread?id=' + encodeURIComponent(id));
        if (this.view !== 'thread' || (this.thread.id && this.thread.id !== id)) return;
        this.thread = Object.assign({ loaded: true }, data);
      } catch (error) {
        this.notify(error.message);
        return;
      }
      // While it is still at work, look again now and then.
      if (this.thread.status === 'sent' || this.thread.status === 'working') {
        threadTimer = setTimeout(function () {
          if (self.view === 'thread' && self.thread.id === id) self.loadThread(id).catch(function () {});
        }, POLL_MS);
      }
    },
    threadsIn(group) {
      var open = function (t) { return t.status === 'sent' || t.status === 'working' || t.waiting; };
      return this.threads.threads.filter(function (t) { return group === 'open' ? open(t) : !open(t); });
    },
    runsText(runs) {
      return { local: '在住户这里干', linux: '在 GitHub Actions 上干', external: '在 claude.ai 上干' }[runs] || '';
    },
    threadSub() {
      var latest = (this.thread.tasks || []).at(-1);
      return this.runsText(this.thread.runs) + (this.thread.loaded ? ' · ' + this.taskStatusText(latest ? this.stateOf(latest) : this.thread.status) : '');
    },
    // The task a report in the thread is for, while it waits for her.
    waitingFor(line) {
      if (line.role !== 'result') return null;
      return (this.thread.tasks || []).find(function (task) { return task.id === line.task && task.waiting; }) || null;
    },
    // How a report in the thread stands, by its task.
    lineState(line) {
      var task = (this.thread.tasks || []).find(function (t) { return t.id === line.task; });
      return task && task.status === line.status ? this.stateOf(task) : line.status;
    },
    sizeText(n) {
      return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
    },
    // A thread's file by its path, or a file a reply handed over by its key.
    fileBytes(file) {
      if (file.key) return this.api('/web/file?key=' + encodeURIComponent(file.key), { bytes: true });
      return this.api('/web/thread/file?id=' + encodeURIComponent(this.thread.id) + '&path=' + encodeURIComponent(file.path), { bytes: true });
    },
    // Pictures as pictures, a page in a sandboxed frame (its scripts run apart from this page and its sign-in), text as text.
    async viewFile(file) {
      this.closeFile();
      var key = file.key || '';
      this.fileView = { path: file.path, key: key, size: file.size, busy: true, kind: '', text: '', url: '' };
      try {
        var bytes = await this.fileBytes(file);
        if (this.fileView.path !== file.path || this.fileView.key !== key) return;
        var ext = extOf(file.path);
        var kind = 'other';
        var text = '';
        var url = '';
        if (IMAGE_TYPES[ext]) {
          kind = 'image';
          url = URL.createObjectURL(new Blob([bytes], { type: IMAGE_TYPES[ext] }));
        } else {
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            kind = text.indexOf('\u0000') >= 0 ? 'other' : /^(html?|xhtml)$/.test(ext) ? 'html' : /^(md|markdown)$/.test(ext) ? 'markdown' : 'text';
          } catch (e) {
            kind = 'other';
          }
          if (kind === 'other') text = '';
        }
        this.fileView = { path: file.path, key: key, size: file.size, busy: false, kind: kind, text: text, url: url };
        var card = this.$refs && this.$refs.fileView;
        if (card && card.scrollIntoView) this.$nextTick(function () { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
      } catch (error) {
        this.fileView = emptyFileView();
        this.notify(error.message);
      }
    },
    closeFile() {
      if (this.fileView.url) URL.revokeObjectURL(this.fileView.url);
      this.fileView = emptyFileView();
    },
    // A file a reply handed over opens on a page of its own; back goes to the chat.
    openChatFile(file) {
      this.view = 'file';
      this.viewFile({ path: file.name, key: file.key, size: file.size });
    },
    async saveFile(file) {
      try {
        var bytes = await this.fileBytes(file);
        var url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
        var link = document.createElement('a');
        link.href = url;
        link.download = file.path.split('/').pop() || 'file';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      } catch (error) {
        this.notify(error.message);
      }
    },
    async sayToThread() {
      var text = this.threadDraft.trim();
      if (!text || this.threadBusy) return;
      this.threadBusy = true;
      try {
        var data = await this.api('/web/thread/say', { method: 'POST', body: { id: this.thread.id, text: text } });
        this.threadDraft = '';
        this.thread = Object.assign({ loaded: true }, data);
        this.loadThread(this.thread.id).catch(function () {});
      } catch (error) {
        this.notify(error.message);
      } finally {
        this.threadBusy = false;
      }
    },

    // ---- usage timeline (用量) ----
    async openUsage() {
      this.view = 'usage';
      this.usage.busy = true;
      try {
        var data = await this.api('/web/usage');
        this.usage = { loaded: true, busy: false, totals: data.totals, rows: data.rows, more: data.more, keepDays: data.keepDays };
      } catch (error) {
        this.usage.busy = false;
        this.notify(error.message);
      }
    },
    async moreUsage() {
      var last = this.usage.rows[this.usage.rows.length - 1];
      if (!last || this.usage.busy) return;
      this.usage.busy = true;
      try {
        var data = await this.api('/web/usage?before=' + last.id);
        this.usage.rows = this.usage.rows.concat(data.rows);
        this.usage.more = data.more;
      } catch (error) {
        this.notify(error.message);
      } finally {
        this.usage.busy = false;
      }
    },
    money(cost) {
      if (!cost) return '$0';
      return '$' + (cost >= 1 ? cost.toFixed(2) : cost >= 0.01 ? cost.toFixed(3) : cost.toFixed(4));
    },
    compact(n) {
      if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
      return String(n);
    },
    // Share of the prompt read from the cache: cache reads over all input, cached or not.
    hitText(t) {
      var all = t ? t.input + t.cacheRead + t.cacheWrite : 0;
      return all ? Math.round(t.cacheRead / all * 100) + '%' : '—';
    },
    totalCost(t) {
      if (!t) return '…';
      if (t.calls && t.unpriced === t.calls) return '没有价格';
      return this.money(t.cost);
    },
    totalCalls(t) {
      return t ? t.calls + ' 次' : '';
    },
    // Calls left out of the cost, when some of the span's calls are priced.
    unpricedText(t) {
      return t && t.unpriced && t.unpriced < t.calls ? t.unpriced + ' 次没价格' : '';
    },
    totalTokens(t) {
      if (!t) return '';
      return '入 ' + this.compact(t.input + t.cacheRead + t.cacheWrite) + ' · 出 ' + this.compact(t.output);
    },
    usageToday() {
      var t = this.usage.totals && this.usage.totals.today;
      if (!t) return '';
      return '今天约 ' + this.totalCost(t) + ' · 命中 ' + this.hitText(t);
    },
    kindText(row) {
      var kind = { chat: '聊天', letter: '写交接信', checkin: '定时找你', heartbeat: '心跳', alarm: '闹钟', task: '线程交回', worker: '线程干活',
        note: '系统提示', compress: '压缩网页', learn: '记下搜到的', trial: '试模型', group: '群聊' }[row.kind] || row.kind;
      var via = { web: '网页', telegram: 'Telegram', wecom: '企业微信' }[row.via];
      return kind + (via ? ' · ' + via : '') + (row.step ? ' · 工具后' : '');
    },
    rowNums(row) {
      var n = function (v) { return v.toLocaleString('en-US'); };
      var write = row.cacheWrite ? '写 ' + n(row.cacheWrite) + (row.cacheWrite1h === row.cacheWrite ? '（1 小时）' : row.cacheWrite1h ? '（1 小时 ' + n(row.cacheWrite1h) + '）' : '（5 分钟）') : '写 0';
      return '新 ' + n(row.input) + ' · 读 ' + n(row.cacheRead) + ' · ' + write + ' · 出 ' + n(row.output) + (row.reasoning ? '（想 ' + n(row.reasoning) + '）' : '');
    },
    usageNote() {
      return '钱按 Anthropic 官方价估，订阅额度、中转和别家的实际花费会不一样；表里没有的模型只记 token。「新」是没走缓存的输入，「读」「写」是缓存，命中是读占全部输入的比例。只留最近 ' + this.usage.keepDays + ' 天。';
    },

    // ---- persona ----
    async loadPersona() {
      this.persona = await this.api('/web/persona');
      this.personaLoaded = true;
    },
    async openSettings() {
      try {
        await this.loadPersona();
      } catch (error) {
        this.notify(error.message);
        return;
      }
      // Its switch (PERSONA_EDIT) is a setting: opened from the chat, the settings may not be read yet.
      if (!this.field('PERSONA_EDIT')) try { this.config = await this.api('/web/config'); this.fillDrafts(); } catch (e) {}
      this.personaDraft = this.persona.text;
      this.view = 'persona';
      this.$nextTick(function () {
        var el = document.querySelector('.persona-edit');
        if (el && matchMedia('(pointer: fine)').matches) el.focus();
      });
    },
    closeSettings() {
      if (this.personaDirty && !confirm('改的还没保存，不要了吗？')) return;
      this.view = 'profile';
    },
    async savePersona() {
      if (this.savingPersona) return;
      this.savingPersona = true;
      try {
        this.persona = await this.api('/web/persona', { method: 'POST', body: { text: this.personaDraft } });
        this.personaDraft = this.persona.text;
        this.notify(this.persona.text ? '人设存好了，下一句就按这个说' : '清空了，先用默认的一句');
        this.view = 'profile';
      } catch (error) {
        this.notify(error.message);
      } finally {
        this.savingPersona = false;
      }
    },
    usageText(usage) {
      if (!usage) return '';
      var share = usage.input ? Math.round(usage.cacheRead / usage.input * 100) : 0;
      return '上一次调用：输入 ' + usage.input + ' token，其中缓存读 ' + usage.cacheRead + '（' + share + '%），输出 ' + usage.output + '（' + this.fmt(usage.at) + '）';
    },

    // ---- settings ----
    field(key) {
      for (var i = 0; i < this.config.fields.length; i++) if (this.config.fields[i].key === key) return this.config.fields[i];
      return null;
    },
    savedHere(key) {
      var f = this.field(key);
      return Boolean(f && (f.kind === 'secret' ? f.saved : f.value));
    },
    // A setting that has a value from somewhere: saved here, or in Cloudflare.
    filled(key) {
      var f = this.field(key);
      return Boolean(f && (f.kind === 'secret' ? f.saved || f.workerHas : f.value || f.fromWorker));
    },
    // A secret's box starts empty (it cannot be read back), so anything typed there is a change.
    configDirty(key) {
      var f = this.field(key);
      var draft = (this.configDraft[key] || '').trim();
      if (!f) return false;
      return f.kind === 'secret' ? Boolean(draft) : draft !== f.value;
    },
    // A choice in effect: saved here, else the Worker's own, else the default.
    inEffect(meta) {
      var f = this.field(meta.key);
      return f ? (f.value || f.fromWorker.toLowerCase() || meta.def || '') : '';
    },
    // Picking what the Worker or the default would give anyway saves nothing, so a later change there still applies.
    pickChoice(meta, choice) {
      var f = this.field(meta.key);
      if (!f || choice === this.inEffect(meta)) return;
      this.saveConfig(meta.key, choice === (f.fromWorker.toLowerCase() || meta.def) ? '' : choice);
    },
    // A setting that only matters once another is on (the voice ones once a provider is picked).
    shown(meta) {
      if (!meta.needs) return true;
      var f = this.field(meta.needs);
      return Boolean(f) && (f.value || f.fromWorker.toLowerCase() || 'off') !== 'off';
    },
    // A default that depends on the voice provider, such as the voice model.
    defFor(meta) {
      if (!meta.defs) return meta.def;
      var f = this.field('VOICE_PROVIDER');
      return f ? meta.defs[f.value || f.fromWorker.toLowerCase()] : undefined;
    },
    picksFor(meta) {
      if (!meta.picks) return [];
      if (Array.isArray(meta.picks)) return meta.picks;
      var f = this.field('VOICE_PROVIDER');
      return (f && meta.picks[f.value || f.fromWorker.toLowerCase()]) || [];
    },
    textInEffect(meta) {
      var f = this.field(meta.key);
      return f ? (f.value || f.fromWorker || this.defFor(meta) || '') : '';
    },
    // Like pickChoice: picking what is already in effect saves nothing.
    pickText(meta, pick) {
      var f = this.field(meta.key);
      if (!f || pick === this.textInEffect(meta)) return;
      this.saveConfig(meta.key, pick === (f.fromWorker || this.defFor(meta)) ? '' : pick);
    },
    pickLabel(meta, pick) {
      return (meta.pickLabels && meta.pickLabels[pick]) || pick;
    },
    // Quiet hours are picked as two whole hours; the box behind them holds "00:00-08:00". Off shows the default.
    hoursPart(meta, which) {
      var text = (this.configDraft[meta.key] || '').trim() || this.textInEffect(meta);
      var match = /^(\d{1,2})(?::\d{2})?\s*[-–—~到]\s*(\d{1,2})/.exec(text) || /^(\d{1,2})(?::\d{2})?\s*[-–—~到]\s*(\d{1,2})/.exec(meta.def);
      return Number(which === 'start' ? match[1] : match[2]) % 24;
    },
    setHours(meta, which, value) {
      var pad = function (h) { return (h < 10 ? '0' : '') + h + ':00'; };
      var start = which === 'start' ? Number(value) : this.hoursPart(meta, 'start');
      var end = which === 'end' ? Number(value) : this.hoursPart(meta, 'end');
      this.configDraft[meta.key] = pad(start) + '-' + pad(end);
    },
    // Like pickText: hours that match what the Worker or the default gives save nothing.
    saveHours(meta) {
      var f = this.field(meta.key);
      var value = (this.configDraft[meta.key] || '').trim();
      if (!f) return;
      this.saveConfig(meta.key, value === (f.fromWorker || meta.def) ? '' : value);
    },
    placeholderFor(meta) {
      var f = this.field(meta.key);
      if (f && f.kind === 'secret') return f.saved || f.workerHas ? '已填，要换就填新的' : '没填';
      if (f && f.fromWorker) return f.fromWorker;
      return meta.placeholder || this.defFor(meta) || '';
    },
    // ---- the settings page's sections ----
    metaOf(key) {
      for (var i = 0; i < CONFIG_GROUPS.length; i++) {
        var meta = CONFIG_GROUPS[i].fields.find(function (m) { return m.key === key; });
        if (meta) return meta;
      }
      if (key === 'STICKERS') return this.STICKER_META;
      return key === 'PERSONA_EDIT' ? this.PERSONA_EDIT_META : { key: key };
    },
    groupOf(id) {
      return CONFIG_GROUPS.find(function (g) { return g.id === id; }) || null;
    },
    // The fields a section shows as plain rows: the IM section shows its doors as steps instead.
    plainFields(group) {
      var self = this;
      if (!group) return [];
      return group.fields.filter(function (meta) { return group.id !== 'im' && self.field(meta.key) && self.shown(meta) && (!meta.more || self.configMore); });
    },
    sectionTitle() {
      var self = this;
      var item = CONFIG_MENU.find(function (m) { return m.id === self.configSection; });
      return item ? item.title : '设置';
    },
    openSection(id) {
      if (this.view !== 'config') this.openConfig(id);
      this.configSection = id;
      this.configMore = false;
      this.helpOpen = {};
      this.stepOpen = {};
      var box = this.$refs && this.$refs.config;
      if (box) box.scrollTop = 0;
      if (id === 'push') this.loadPushState().catch(function () {});
    },
    // Back one step: from a section to the list, from the list to the chat.
    configBack() {
      if (!this.configSection) return this.closeConfig();
      this.configSection = '';
      var box = this.$refs && this.$refs.config;
      if (box) box.scrollTop = 0;
    },
    choiceLabel(meta, choice) {
      return (meta.labels && meta.labels[choice]) || choice;
    },
    helpFor(meta) {
      // Which gateway the key comes from is the usual question when ElevenLabs or Cartesia says no key arrived.
      var keyFrom = this.config.voice && this.config.voice.keyFrom;
      if (meta.key === 'VOICE_API_KEY' && keyFrom) {
        return '空着就用 AI Gateway「' + keyFrom + '」的 Provider Keys 里这一家的 key（别名 default）。key 存在别的 Gateway，就到「供应商」里改「AI Gateway 的名字」，或者直接填在这里。';
      }
      if (meta.helps) {
        var provider = this.inEffect(this.metaOf('VOICE_PROVIDER'));
        if (meta.helps[provider] !== undefined) return meta.helps[provider];
      }
      return meta.help || '';
    },
    toggleHelp(key) {
      var next = Object.assign({}, this.helpOpen);
      next[key] = !next[key];
      this.helpOpen = next;
    },
    hasMore(group) {
      var self = this;
      return group.fields.some(function (meta) { return meta.more && self.field(meta.key) && self.shown(meta); });
    },
    groupHint(group) {
      return group.hint || '';
    },
    // The address WeCom's 「接收消息」 takes.
    wecomUrl() {
      return location.origin + this.residentPrefix() + '/messengers/wecom/webhook';
    },
    async copyText(text) {
      try { await navigator.clipboard.writeText(text); this.notify('复制好了'); } catch (e) { this.notify('复制不了，长按自己复制'); }
    },
    // A chat door's steps: done when every setting in it has a value; the first one not done is open.
    doorSteps(door) {
      var self = this;
      var now = -1;
      return DOOR_STEPS[door].map(function (step, index) {
        var done = step.keys.every(function (key) { return self.filled(key); });
        if (!step.extra && !done && now < 0) now = index;
        var state = step.extra ? 'extra' : done ? 'done' : now === index ? 'now' : 'later';
        var open = state === 'now' || Boolean(self.stepOpen[door + ':' + step.id]);
        return Object.assign({}, step, { index: index, state: state, open: open, fields: step.keys.map(function (key) { return self.metaOf(key); }).filter(function (meta) { return self.field(meta.key); }) });
      });
    },
    // A door not started: only its name and a button, until she starts.
    doorIdle(door) {
      if (this.stepOpen[door + ':start']) return false;
      if (door === 'telegram') return !(this.config.telegram || {}).from && !this.filled('TG_ALLOWED');
      return (this.config.wecom || {}).gap === 'off';
    },
    toggleStep(door, id) {
      var next = Object.assign({}, this.stepOpen);
      next[door + ':' + id] = !next[door + ':' + id];
      this.stepOpen = next;
    },
    stepSummary(step) {
      var self = this;
      if (step.id === 'who') return step.keys.map(function (key) { return self.textInEffect(self.metaOf(key)); }).join('、');
      return '都填好了';
    },
    // How a door stands, as one pill.
    doorPill(door) {
      if (door === 'telegram') {
        var t = this.config.telegram || {};
        if (!t.from) return { text: '没接', cls: '' };
        if (t.error) return { text: '出错了', cls: 'bad' };
        if (!t.here) return { text: '没接好', cls: 'warn' };
        if (!this.textInEffect(this.metaOf('TG_ALLOWED'))) return { text: '差一步', cls: 'warn' };
        return { text: '已连', cls: 'ok' };
      }
      var w = this.config.wecom || {};
      if (w.gap === 'off') return { text: '没接', cls: '' };
      var left = this.doorSteps('wecom').filter(function (step) { return step.state === 'now' || step.state === 'later'; }).length;
      if (left) return { text: '差 ' + left + ' 步', cls: 'warn' };
      if (!w.relay) return { text: '转发机连不上', cls: 'bad' };
      if (w.error || w.refused) return { text: '有情况', cls: 'warn' };
      return { text: '已连', cls: 'ok' };
    },
    // What each door is, under its name.
    doorHint(door) {
      if (door === 'telegram') {
        var t = this.config.telegram || {};
        return t.bot ? '@' + t.bot : '用一个 Telegram bot 私聊它';
      }
      return '回消息要经过一台固定 IP 的转发机（relay/wecom）';
    },
    doorNeeds(door) {
      if (door === 'telegram') {
        var t = this.config.telegram || {};
        return Boolean(t.from && (t.error || !t.here || !this.textInEffect(this.metaOf('TG_ALLOWED'))));
      }
      var w = this.config.wecom || {};
      return w.gap !== 'off' && Boolean(w.gap || !w.relay || w.error || w.refused || !(w.allowed || []).length);
    },
    // How Telegram stands: the bot, whether its messages come here, the last error Telegram had sending one.
    telegramStatus() {
      var t = this.config.telegram || {};
      if (!t.from) return '没接。';
      if (t.error) return t.error;
      var bits = [];
      if (!t.here) bits.push('填了 @' + t.bot + ' 的 token，但它的消息还没指到这里：点下面的「重新接一次」。');
      else bits.push('接好了：@' + t.bot + (t.from === 'cloudflare' ? '（token 在 Cloudflare 里）' : '') + '。');
      if (!this.textInEffect(this.metaOf('TG_ALLOWED'))) bits.push('还没放行任何人，填「谁能在 Telegram 上跟它说话」。');
      if (t.lastError) bits.push(this.fmt(t.lastError.at) + ' Telegram 送消息出错：' + t.lastError.reason);
      return bits.join(' ');
    },
    async reconnectTelegram() {
      this.configBusy = 'telegram';
      try {
        var done = await this.api('/web/telegram/connect', { method: 'POST', body: {} });
        this.config.telegram = done.telegram;
        this.notify('接好了');
      } catch (error) {
        this.notify(error.message);
      } finally {
        this.configBusy = '';
      }
    },
    // How WeCom stands: what is still missing, the relay, the last error, who was shut out.
    wecomStatus() {
      var w = this.config.wecom || {};
      var labels = { WECOM_CORP_ID: '企业 ID', WECOM_AGENT_ID: 'AgentId', WECOM_SECRET: 'Secret', WECOM_RELAY_URL: '转发地址', WECOM_RELAY_KEY: '转发钥匙', WECOM_TOKEN: 'Token', WECOM_AES_KEY: 'EncodingAESKey' };
      if (w.gap === 'off') return '没接。';
      var bits = [];
      if (w.gap) bits.push('还差' + (labels[w.gap] || w.gap) + '。');
      else if (!w.relay) bits.push('转发机连不上：看看转发地址、钥匙，和转发机上的 Tunnel。');
      else bits.push(w.relay.amr ? '接好了，能收发文字、图片和语音。' : '接好了，能收发文字和图片；转发机没装转码（--media），语音回复改发文字。');
      if (!w.gap && !(w.allowed || []).length) bits.push('还没放行任何人，填「谁能在企业微信上跟它说话」。');
      if (w.error) bits.push(this.fmt(w.error.at) + ' 出错：' + w.error.reason);
      if (w.refused) bits.push(this.fmt(w.refused.at) + ' 挡下了账号 ' + w.refused.user + '，是你的话填进「谁能在企业微信上跟它说话」。');
      return bits.join(' ');
    },
    // Only what is worth a glance: saved here, set in Cloudflare (and as which variable), or still to be filled in.
    tagText(meta) {
      var f = this.field(meta.key);
      if (!f) return '';
      // What the server says voice messages still wait for (it knows whether AI Gateway can supply the key).
      if (this.config.voice && this.config.voice.gap === meta.key) return '要填';
      if (f.kind === 'secret') return f.saved ? '已存' : (f.workerHas ? 'Cloudflare：' + meta.key : '');
      if (f.value) return f.kind === 'choice' ? '' : '已存';
      if (f.fromWorker) return 'Cloudflare：' + meta.key;
      return meta.defs && !this.defFor(meta) ? '要填' : '';
    },
    tagClass(meta) {
      var text = this.tagText(meta);
      return text === '要填' ? 'warn' : (text === '已存' ? 'ok' : '');
    },
    voiceGapLabel() {
      return { VOICE_ID: '声音', VOICE_MODEL: '模型', VOICE_API_KEY: '一把 key' }[this.config.voice && this.config.voice.gap] || '';
    },
    voiceStatus() {
      var voice = this.config.voice || {};
      var hear = voice.hears === 'scribe' ? '你的语音条用 ElevenLabs 转成文字给它' : voice.hears === 'whisper' ? '你的语音条会先转成文字给它' : '听不了语音条：Worker 没绑 AI';
      if (voice.gap === 'off') return hear + '；它不发语音。';
      if (voice.gap) return '还差' + this.voiceGapLabel() + '，填好它才发语音。';
      var provider = this.metaOf('VOICE_PROVIDER');
      var reply = this.metaOf('VOICE_REPLY');
      var key = voice.keyFrom ? 'key 用 AI Gateway「' + voice.keyFrom + '」里存的。' : '';
      return hear + '；用 ' + this.choiceLabel(provider, this.inEffect(provider)) + ' 说话，' + this.choiceLabel(reply, this.inEffect(reply)) + '。' + key;
    },
    sectionNeeds(id) {
      if (id === 'thinking') return Boolean(this.letterError || (this.letter.write && this.letter.write.state === 'failed') || this.letterCanRetry());
      var voice = this.config.voice || {};
      if (id === 'tasks') return this.inEffect(this.metaOf('CLOUD_TASKS')) === 'on' && (!this.cloud.configured || Boolean(this.cloud.github && this.cloud.github.problem));
      if (id === 'im') return this.doorNeeds('telegram') || this.doorNeeds('wecom');
      return id === 'voice' && Boolean(voice.gap) && voice.gap !== 'off';
    },
    // The one line on the right of each row of the list.
    sectionSummary(id) {
      var self = this;
      var text = function (key) { return self.textInEffect(self.metaOf(key)); };
      var choice = function (key) { var meta = self.metaOf(key); return self.choiceLabel(meta, self.inEffect(meta)); };
      var host = function (url) { try { return new URL(url).host; } catch (e) { return url; } };
      if (!this.config.fields.length) return '';
      switch (id) {
        case 'aelios':
          if (!text('AELIOS_URL')) return '没接';
          return (this.aelios ? '接着 ' : '填了，还没连上 ') + host(text('AELIOS_URL'));
        case 'im': {
          var t = this.config.telegram || {};
          var w = this.config.wecom || {};
          var tg = !t.from ? '' : t.error ? 'Telegram 出错了' : !t.here ? 'Telegram 没接好' : 'Telegram @' + t.bot;
          var wecom = w.gap === 'off' ? '' : w.gap ? '企业微信还差' + w.gap.replace('WECOM_', '') : !w.relay ? '企业微信转发机连不上'
            : '企业微信 ' + ((w.allowed || []).join('、') || '谁都不回');
          return [tg, wecom].filter(Boolean).join(' · ') || '只在网页上聊';
        }
        case 'push':
          if (this.inEffect(this.metaOf('WEB_PUSH')) === 'off') return '不推';
          return this.push.on ? '这台设备开着' : this.push.devices ? this.push.devices + ' 台设备' : '没开';
        case 'heartbeat': {
          var beats = this.textInEffect(this.metaOf('HEARTBEAT')) || this.metaOf('HEARTBEAT').def;
          return (text('CHECKIN_SCHEDULE') || '不主动找') + ' · ' + (beats === '0' ? '心跳关' : '心跳 ' + beats + ' 次')
            + (this.inEffect(this.metaOf('ALARMS')) === 'on' ? ' · 闹钟 ' + this.alarms.alarms.length + ' 个' : '');
        }
        case 'voice': {
          var voice = this.config.voice || {};
          if (voice.gap === 'off') return '只听，不发语音';
          if (voice.gap) return '还差' + this.voiceGapLabel();
          return choice('VOICE_PROVIDER') + ' · ' + choice('VOICE_REPLY');
        }
        case 'stickers':
          if (this.inEffect(this.STICKER_META) === 'off') return '关';
          return '开 · ' + (this.stickers.packs.length ? this.stickers.packs.length + ' 个包' : '还没有包');
        case 'web':
          return '搜网' + (this.inEffect(this.metaOf('WEB_SEARCH')) === 'off' ? '关' : '开') + ' · 读网页' + choice('WEB_FETCH')
            + (this.sites.length && this.inEffect(this.metaOf('WEB_FETCH')) !== 'off' ? ' · ' + this.sites.length + ' 个网站带钥匙' : '');
        case 'mcp':
          return this.mcp.servers.length ? this.mcp.servers.map(function (server) { return server.name; }).join('、') : '没接';
        case 'tasks':
          if (this.inEffect(this.metaOf('CLOUD_TASKS')) !== 'on') return '关';
          var hands = { local: '自己的线程', linux: '自己的线程 + GitHub Actions', external: 'claude.ai + 自己的线程', all: 'claude.ai + 自己的线程 + GitHub Actions', incomplete: '触发网址没填对' }[this.cloud.mode] || '开';
          return hands + ' · 24 小时内派了 ' + this.cloud.today + ' 单';
        case 'thinking':
          return this.letterWriteStatus() + ' · ' + this.letterDeliveryCounts();
        case 'custom':
          return 'Gateway ' + (text('AI_GATEWAY_ID') || 'default') + (text('CUSTOM_BASE_URL') ? ' · 中转 ' + host(text('CUSTOM_BASE_URL')) : '');
        default:
          return '';
      }
    },
    fillDrafts() {
      var drafts = {};
      this.config.fields.forEach(function (f) { drafts[f.key] = f.kind === 'secret' ? '' : f.value; });
      this.configDraft = drafts;
    },
    async openConfig(section) {
      try {
        this.config = await this.api('/web/config');
      } catch (error) {
        this.notify(error.message);
        return;
      }
      this.fillDrafts();
      this.configSection = section || '';
      this.configMore = false;
      this.configError = {};
      this.helpOpen = {};
      this.stepOpen = {};
      this.mcpError = '';
      this.stickerError = '';
      this.stickerSkipped = [];
      this.view = 'config';
      this.loadMcp().catch(function () {});
      this.loadSites().catch(function () {});
      this.loadStickers().catch(function () {});
      this.loadTasks().catch(function () {});
      this.loadAlarms().catch(function () {});
      this.loadPushState().catch(function () {});
      await this.loadLetter();
    },
    closeConfig() {
      var self = this;
      var dirty = this.config.fields.some(function (f) { return self.configDirty(f.key); });
      if (dirty && !confirm('有没存的，不要了吗？')) return;
      this.view = 'chat';
      this.scrollSoon(true);
    },
    async saveConfig(key, value) {
      if (this.configBusy) return;
      this.configBusy = key;
      this.configError[key] = '';
      try {
        var keep = Object.assign({}, this.configDraft);
        this.config = await this.api('/web/config', { method: 'POST', body: { key: key, text: value || '' } });
        // Only this setting's box is reset; anything typed in the others stays.
        var f = this.field(key);
        keep[key] = f && f.kind !== 'secret' ? f.value : '';
        this.configDraft = keep;
        this.notify(value ? '存好了，下一句开始用' : '清掉了，用回 Cloudflare 里的或默认的');
        await this.loadLetter();
        if (key.indexOf('AELIOS_') === 0) this.aelios = Boolean((await this.api('/web/check')).aelios);
        if (key.indexOf('CLOUD_TASK') === 0) await this.loadTasks();
        // A new GitHub token: the resident sets its repository up now, so a token that cannot do it says so here.
        if (key === 'CLOUD_TASK_GITHUB_TOKEN' && value) await this.setUpGitHub();
        if (key === 'ALARMS' || key === 'TIME_ZONE') await this.loadAlarms();
        if (key === 'WEB_PUSH') await this.loadPushState();
      } catch (error) {
        this.configError[key] = error.message;
      } finally {
        this.configBusy = '';
      }
    },

    // ---- notifications on this device (web push) ----
    preparePush() {
      var ua = navigator.userAgent || '';
      this.push.ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
      this.push.standalone = Boolean((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone);
      this.push.supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(function () {});
    },
    async loadPushState() {
      if (this.miniApp) return;
      try {
        var data = await this.api('/web/push');
        this.push.devices = data.devices;
      } catch (e) {}
      if (!this.push.supported) return;
      try {
        var registration = await navigator.serviceWorker.getRegistration('/');
        var subscription = registration && (await registration.pushManager.getSubscription());
        this.push.on = Boolean(subscription) && Notification.permission === 'granted';
      } catch (e) {
        this.push.on = false;
      }
    },
    // Ask once in the chat, until she turns it on or says not now.
    pushInvite() {
      return this.push.supported && !this.miniApp && !this.push.on && this.push.asked !== 'no' && this.lines.length > 2 && (!this.push.ios || this.push.standalone);
    },
    dismissPush() {
      this.push.asked = 'no';
      remember('resident.push.ask', 'no');
    },
    async enablePush() {
      if (this.push.busy) return;
      this.push.busy = true;
      this.push.error = '';
      try {
        var permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('没给通知权限：在浏览器设置里允许这个网页发通知');
        var registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        var key = (await this.api('/web/push')).publicKey;
        var subscription = await registration.pushManager.getSubscription();
        if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(key) });
        var data = await this.api('/web/push/subscribe', { method: 'POST', body: { subscription: subscription.toJSON() } });
        this.push.devices = data.devices;
        this.push.on = true;
        this.dismissPush();
        this.notify('通知开好了');
      } catch (error) {
        this.push.error = error.message;
        this.notify(error.message);
      } finally {
        this.push.busy = false;
      }
    },
    async disablePush() {
      if (this.push.busy) return;
      this.push.busy = true;
      try {
        var registration = await navigator.serviceWorker.getRegistration('/');
        var subscription = registration && (await registration.pushManager.getSubscription());
        if (subscription) {
          var data = await this.api('/web/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } });
          this.push.devices = data.devices;
          await subscription.unsubscribe();
        }
        this.push.on = false;
        this.notify('这台设备不收通知了');
      } catch (error) {
        this.notify(error.message);
      } finally {
        this.push.busy = false;
      }
    },
    async testPush() {
      try {
        var result = await this.api('/web/push/test', { method: 'POST', body: {} });
        this.notify(result.sent ? '发出去了，看看通知栏' : result.failed.length ? '没发出去：' + result.failed[0] : '还没有设备开通知');
      } catch (error) {
        this.notify(error.message);
      }
    },

    // ---- writing a letter and delivering the already-written letter are separate states ----
    setLetter(data) {
      data = data || {};
      var count = function (n) { return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
      var time = function (n) { return Number.isFinite(n) && n >= 0 && n <= 8640000000000000 ? n : null; };
      var text = function (s) { return typeof s === 'string' ? s : ''; };
      var write = data.write;
      var delivery = data.delivery || {};
      var latest = delivery.latest;
      this.letter = {
        canRetry: data.canRetry === true,
        write: write ? { state: text(write.state), at: time(write.at), error: text(write.error) } : null,
        delivery: {
          pending: count(delivery.pending), failed: count(delivery.failed), blocked: count(delivery.blocked),
          latest: latest ? { id: text(latest.id), at: time(latest.at), status: text(latest.status), attempts: count(latest.attempts), lastError: text(latest.lastError), sentAt: time(latest.sentAt) } : null
        }
      };
    },
    letterTime(at) {
      return at === null || at === undefined ? '暂无记录' : this.fmt(at);
    },
    letterWriteStatus() {
      var write = this.letter.write;
      if (!write) return '暂无写信状态';
      return { writing: '正在写信', recovering: '已有恢复任务，正在恢复写信', written: '信已写好', empty: '没有旧内容可收，本次未写信', failed: '写信失败，旧聊天仍保留' }[write.state] || '写信状态未知';
    },
    letterDeliveryStatus() {
      var latest = this.letter.delivery.latest;
      if (!latest) return 'Aelios：暂无送达记录';
      return 'Aelios 最近一封：' + ({ pending: '待发送（自动尝试中）', sent: '已确认送达', failed: '发送失败，可手动重试', blocked: '已暂停，请检查原目标配置' }[latest.status] || '送达状态未知');
    },
    letterDeliveryCounts() {
      var delivery = this.letter.delivery;
      return '待发送 ' + delivery.pending + ' · 待重试 ' + delivery.failed + ' · 已暂停 ' + delivery.blocked;
    },
    letterDeliveryDetail() {
      var latest = this.letter.delivery.latest;
      if (!latest) return '';
      return '最近发送记录：' + this.letterTime(latest.at) + ' · 已尝试 ' + latest.attempts + ' 次'
        + (latest.sentAt !== null ? ' · 确认送达：' + this.letterTime(latest.sentAt) : '');
    },
    letterCanRetry() {
      return this.letter.canRetry;
    },
    async loadLetter() {
      if (this.letterBusy) return;
      this.letterBusy = 'load';
      this.letterError = '';
      try {
        this.setLetter(await this.api('/web/letter'));
      } catch (error) {
        this.letterError = '读取交接信状态失败，当前显示可能不是最新的：' + error.message;
      } finally {
        this.letterBusy = '';
      }
    },
    async retryLetter() {
      if (this.letterBusy || this.configBusy || !this.letterCanRetry()) return;
      this.letterBusy = 'retry';
      this.letterError = '';
      try {
        // The server retries all failed/blocked deliveries, checking their original target again. No model call.
        this.setLetter(await this.api('/web/letter/retry', { method: 'POST' }));
        this.notify(this.letterCanRetry() ? '仍有未送达的信，请查看状态和原因' : '重试请求已处理，请查看送达状态');
      } catch (error) {
        this.letterError = '重试同步失败：' + error.message;
      } finally {
        this.letterBusy = '';
      }
    },

    // ---- alarms it set itself ----
    async loadAlarms() {
      this.alarms = await this.api('/web/alarms');
    },
    async removeAlarm(alarm) {
      if (this.alarmBusy) return;
      this.alarmBusy = alarm.id;
      this.alarmError = '';
      try {
        this.alarms = await this.api('/web/alarms/remove', { method: 'POST', body: { id: alarm.id } });
        this.notify('删掉了');
      } catch (error) {
        this.alarmError = error.message;
      } finally {
        this.alarmBusy = '';
      }
    },
    nextAlarm() {
      var first = this.alarms.alarms[0];
      return this.alarms.alarms.length ? this.alarms.alarms.length + ' 个 · 下次 ' + first.next : '没有';
    },

    // ---- 后台帮忙 on the settings page ----
    async loadTasks() {
      this.cloud = await this.api('/web/tasks');
    },
    cloudHost() {
      try { return new URL(this.cloud.origin).host; } catch (e) { return ''; }
    },
    taskStatusText(status) {
      return TASK_STATUS[status] || status;
    },
    linkText(link) {
      var pull = link.match(/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/);
      if (pull) return pull[1] + ' #' + pull[2];
      try { return new URL(link).host; } catch (e) { return '链接'; }
    },
    async copyPrompt() {
      try {
        await navigator.clipboard.writeText(this.cloud.prompt);
        this.notify('复制好了，贴进定时任务的提示词');
      } catch (e) {
        this.notify('复制不了，点一下那段文字全选后自己复制');
      }
    },
    async setUpGitHub() {
      if (this.cloudBusy) return;
      this.cloudBusy = 'github';
      this.cloudError = '';
      try {
        this.cloud = await this.api('/web/tasks/github', { method: 'POST', body: {} });
      } catch (error) {
        await this.loadTasks().catch(function () {});
      } finally {
        this.cloudBusy = false;
      }
    },
    async testTask(execution) {
      if (this.cloudBusy) return;
      this.cloudBusy = execution || true;
      this.cloudError = '';
      try {
        this.cloud = await this.api('/web/tasks/test', { method: 'POST', body: execution ? { execution: execution } : {} });
        this.notify('派出去了，几分钟后回来看');
      } catch (error) {
        this.cloudError = error.message;
      } finally {
        this.cloudBusy = false;
      }
    },

    // ---- roles: job templates for threads, each with the model its threads use ----
    // The models to pick from: the chat's, the recent ones, the usual ones, and the list kept in Aelios.
    roleModels() {
      var seen = {};
      var list = [];
      var add = function (id) { if (id && !seen[id]) { seen[id] = true; list.push(id); } };
      add(this.model.model);
      (this.model.recent || []).forEach(add);
      FAVORITES.forEach(add);
      if (this.aeliosModels.curated) this.aeliosModels.items.forEach(function (item) { add(item.id); });
      return list;
    },
    // The roles as rows, and a row for a new one while it is being written; the one being edited shows its form.
    roleRows() {
      var rows = this.cloud.roles.map(function (role) { return { key: role.name, role: role }; });
      if (this.roleEdit && this.roleEdit.fresh) rows.push({ key: ' new', role: null });
      return rows;
    },
    editingRole(row) {
      var edit = this.roleEdit;
      return Boolean(edit) && (row.role ? !edit.fresh && edit.name === row.role.name : edit.fresh);
    },
    editRole(role) {
      var model = role ? role.model : '';
      var listed = !model || this.roleModels().indexOf(model) >= 0;
      this.roleError = '';
      this.roleEdit = { fresh: !role, name: role ? role.name : '', template: role ? role.template : '', pick: listed ? model : '…', own: listed ? '' : model };
    },
    roleModelText(role) {
      return role.model ? this.shortName(role.model) : '线程的模型';
    },
    async saveRole() {
      var edit = this.roleEdit;
      if (!edit || this.roleBusy) return;
      this.roleBusy = true;
      this.roleError = '';
      try {
        var model = edit.pick === '…' ? edit.own.trim() : edit.pick;
        var saved = await this.api('/web/tasks/roles', { method: 'POST', body: { name: edit.name, template: edit.template, model: model } });
        this.cloud.roles = saved.roles;
        this.roleEdit = null;
      } catch (error) {
        this.roleError = error.message;
      } finally {
        this.roleBusy = false;
      }
    },
    async removeRole(role) {
      if (this.roleBusy || !confirm('删掉 ' + role.name + '？派活时就不能再用它了。')) return;
      this.roleBusy = true;
      try {
        this.cloud.roles = (await this.api('/web/tasks/roles/remove', { method: 'POST', body: { name: role.name } })).roles;
        if (this.roleEdit && this.roleEdit.name === role.name) this.roleEdit = null;
      } catch (error) {
        this.roleError = error.message;
      } finally {
        this.roleBusy = false;
      }
    },

    // ---- other MCP servers ----
    async loadMcp() {
      this.mcp = await this.api('/web/mcp');
    },
    mcpText(server) {
      if (server.state === 'ready') return '能用 · ' + server.tools + ' 个工具 · 每轮约 ' + server.tokens + ' token' + (server.hasKey ? ' · 带 key' : '');
      if (server.state === 'authenticating') return '等你授权：点「去授权」登录，授权完回来就好了';
      if (server.state === 'connecting' || server.state === 'connected' || server.state === 'discovering') return '连接中…';
      return '没连上' + (server.hasKey ? '（带 key，重连不用再填）' : '') + '：点「重连」再试，一直不行就断开重接';
    },
    // Inside Telegram a sign-in opens in the browser, which can come back here.
    openAuth(server, event) {
      if (!telegram || !server.authUrl) return;
      event.preventDefault();
      try { telegram.openLink(server.authUrl); } catch (error) { window.open(server.authUrl, '_blank', 'noopener'); }
    },
    async addMcp() {
      if (this.mcpBusy) return;
      this.mcpBusy = 'add';
      this.mcpError = '';
      try {
        this.mcp = await this.api('/web/mcp', { method: 'POST', body: { name: this.mcpDraft.name.trim(), url: this.mcpDraft.url.trim(), key: this.mcpDraft.key.trim() } });
        this.mcpDraft = { name: '', url: '', key: '' };
        var waiting = this.mcp.servers.some(function (server) { return server.authUrl; });
        this.notify(waiting ? '还要登录授权：点「去授权」' : '接上了，下一句开始能用');
      } catch (error) {
        this.mcpError = error.message;
      } finally {
        this.mcpBusy = '';
      }
    },
    // A server that dropped is tried again where it is; one waiting for a sign-in just shows how it is now.
    async retryMcp(server) {
      if (this.mcpBusy) return;
      this.mcpBusy = server.id;
      this.mcpError = '';
      try {
        this.mcp = server.state === 'not-connected' || server.state === 'failed'
          ? await this.api('/web/mcp/retry', { method: 'POST', body: { id: server.id } })
          : await this.api('/web/mcp');
      } catch (error) {
        this.mcpError = error.message;
      } finally {
        this.mcpBusy = '';
      }
    },
    async removeMcp(server) {
      if (this.mcpBusy || !confirm('断开 ' + server.name + '？要用再接。')) return;
      this.mcpBusy = server.id;
      try {
        this.mcp = await this.api('/web/mcp/remove', { method: 'POST', body: { id: server.id } });
        this.notify('断开了');
      } catch (error) {
        this.mcpError = error.message;
      } finally {
        this.mcpBusy = '';
      }
    },

    // ---- keys for sites web_fetch reads ----
    sitePlaceholder() {
      return this.siteDraft.lines.some(function (line) { return line.name.trim().toLowerCase() === 'authorization'; })
        ? '网站，比如 raw.githubusercontent.com'
        : '网站，比如 example.com';
    },
    /** Fills in the names a common kind of key needs; values already typed stay. */
    sitePreset(kind) {
      var names = kind === 'access' ? ['CF-Access-Client-Id', 'CF-Access-Client-Secret'] : ['Authorization'];
      var typed = this.siteDraft.lines.filter(function (line) { return line.value.trim(); }).map(function (line) { return line.value; });
      this.siteDraft.lines = names.map(function (name, index) { return { name: name, value: typed[index] || '' }; });
    },
    /** The key as the resident reads it, one "Name: value" per line, or '' while a row is half filled. */
    siteKeyText() {
      var lines = this.siteDraft.lines
        .map(function (line) {
          var name = String(line.name || '').trim().replace(/\s*[:：]+$/, '');
          // A value may be pasted with its name in front, as Cloudflare's copy button gives it.
          var value = String(line.value || '').trim();
          if (name && value.toLowerCase().indexOf(name.toLowerCase()) === 0) value = value.slice(name.length).replace(/^\s*[:：]\s*/, '');
          // A bare token for Authorization goes as a bearer token.
          if (name.toLowerCase() === 'authorization' && value && !/\s/.test(value)) value = 'Bearer ' + value;
          return { name: name, value: value };
        })
        .filter(function (line) { return line.name || line.value; });
      if (!lines.length || lines.some(function (line) { return !line.name || !line.value; })) return '';
      return lines.map(function (line) { return line.name + ': ' + line.value; }).join('\n');
    },
    async loadSites() {
      this.sites = (await this.api('/web/sites')).sites;
    },
    async addSite() {
      if (this.siteBusy) return;
      this.siteBusy = 'add';
      this.siteError = '';
      try {
        this.sites = (await this.api('/web/sites', { method: 'POST', body: { site: this.siteDraft.site.trim(), key: this.siteKeyText() } })).sites;
        this.siteDraft = emptySiteDraft();
        this.notify('存上了，下一句开始读那个网站会带上');
      } catch (error) {
        this.siteError = error.message;
      } finally {
        this.siteBusy = '';
      }
    },
    async removeSite(site) {
      if (this.siteBusy || !confirm('拿掉 ' + site.host + ' 的钥匙？')) return;
      this.siteBusy = site.host;
      try {
        this.sites = (await this.api('/web/sites/remove', { method: 'POST', body: { host: site.host } })).sites;
        this.notify('拿掉了');
      } catch (error) {
        this.siteError = error.message;
      } finally {
        this.siteBusy = '';
      }
    },

    // ---- stickers ----
    async loadStickers() {
      this.stickers = await this.api('/web/stickers');
    },
    packText(pack) {
      var from = { zip: '压缩包', telegram: 'Telegram 贴纸包', own: '它自己画的' }[pack.source] || '';
      return pack.stickers.length + ' 张 · ' + from + (pack.enabled ? ' · 每轮约 ' + pack.tokens + ' token' : '');
    },
    async stickerCall(busy, path, body, done) {
      if (this.stickerBusy) return;
      this.stickerBusy = busy;
      this.stickerError = '';
      try {
        var result = await this.api(path, body);
        this.stickers = result;
        this.stickerSkipped = result.skipped || [];
        if (done) this.notify(done);
        return true;
      } catch (error) {
        this.stickerError = error.message;
        return false;
      } finally {
        this.stickerBusy = '';
      }
    },
    async importStickerLink() {
      var link = this.stickerLink.trim();
      if (!link) return;
      if (await this.stickerCall('link', '/web/stickers/import', { method: 'POST', body: { url: link } }, '导进来了，下一句开始能用')) this.stickerLink = '';
    },
    async importStickerFile(event) {
      var input = event.target;
      var file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      if (file.size > 16 * 1024 * 1024) { this.stickerError = '压缩包最多 16 MB'; return; }
      await this.stickerCall('file', '/web/stickers/import?name=' + encodeURIComponent(file.name), { method: 'POST', raw: file, type: 'application/zip' }, '导进来了，下一句开始能用');
    },
    togglePack(pack) {
      this.stickerCall(pack.id, '/web/stickers/pack', { method: 'POST', body: { id: pack.id, on: !pack.enabled } }, pack.enabled ? '关了，它不会再发这个包' : '开了');
    },
    removePack(pack) {
      if (!confirm('删掉「' + pack.name + '」整个包？')) return;
      this.stickerCall(pack.id, '/web/stickers/remove', { method: 'POST', body: { id: pack.id } }, '删掉了');
    },
    removeSticker(pack, sticker) {
      if (!confirm('删掉 ' + pack.id + '/' + sticker.name + '？')) return;
      this.stickerCall(sticker.key, '/web/stickers/delete', { method: 'POST', body: { key: sticker.key } }, '删掉了');
    },
    editSticker(sticker, when) {
      if (when.trim() === sticker.when) return;
      this.stickerCall(sticker.key, '/web/stickers/edit', { method: 'POST', body: { key: sticker.key, when: when } }, '改好了');
    },

    // ---- small things ----
    viaLabel(via) {
      return { telegram: 'Telegram', wecom: '企业微信', web: '网页', checkin: '主动找你', task: '线程交回' }[via] || '';
    },
    fmt(at) {
      var date = new Date(at);
      var now = new Date();
      var time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
      if (date.toDateString() === now.toDateString()) return time;
      return (date.getMonth() + 1) + '-' + date.getDate() + ' ' + time;
    },
    // Night, day, or as the system says.
    setTheme(pref) {
      this.themePref = pref;
      remember('resident.theme', pref);
      this.applyTheme();
    },
    applyTheme() {
      var dark = this.themePref === 'dark' || (this.themePref !== 'light' && (typeof matchMedia === 'undefined' || matchMedia('(prefers-color-scheme: dark)').matches));
      this.theme = dark ? 'dark' : 'light';
      document.documentElement.dataset.theme = this.theme;
      var meta = document.querySelector && document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', dark ? '#070a16' : '#F8F5EF');
      this.syncTelegramTheme();
    },
    notify(message) {
      var self = this;
      this.toast = message;
      setTimeout(function () { if (self.toast === message) self.toast = ''; }, 2400);
    }
  }, typeof groupPage === 'function' ? groupPage() : {});
}
