// A scripted model for local tests (FAKE_MODEL=true): no AI binding, no login, no cost.
// It answers from the last user message so the tests can drive every path.

import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 }
});

type Prompt = LanguageModelV4CallOptions["prompt"];

let checkins = 0;
// What the previous call sent, to check that the letter turn repeats it exactly (and so is read from cache).
let previous: { system: string; tools: string; messages: string[] } | null = null;
// Whether 卡住测试 has had its one quiet call.
let stalledOnce = false;
// How many times 重来测试 has been answered.
let redos = 0;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: { type?: string; text?: string; output?: { value?: unknown } }) => {
      if (part.type === "text") return part.text ?? "";
      if (part.type === "tool-result") {
        const value = part.output?.value;
        return typeof value === "string" ? value : JSON.stringify(value);
      }
      return "";
    })
    .join("");
}

function toolOf(content: unknown): string {
  return Array.isArray(content) ? ((content.find((part) => part.type === "tool-result") as { toolName?: string } | undefined)?.toolName ?? "") : "";
}

/** Tool results after the last message of hers. */
function toolResultsSince(prompt: Prompt): number {
  let count = 0;
  for (let i = prompt.length - 1; i >= 0 && prompt[i].role !== "user"; i -= 1) if (prompt[i].role === "tool") count += 1;
  return count;
}

function lastOf(prompt: Prompt, role: string): string {
  for (let i = prompt.length - 1; i >= 0; i -= 1) if (prompt[i].role === role) return textOf(prompt[i].content);
  return "";
}

const HEART_ROWS = ["........", ".XX..XX.", "XXXXXXXX", "XXXXXXXX", ".XXXXXX.", "..XXXX..", "...XX...", "........"];
const HEART = { name: "heart", emoji: "❤️", when: "When she says she loves me.", palette: { X: "#e84868", o: "#ffaabb" }, frames: [HEART_ROWS, HEART_ROWS.map((row) => row.replace(/X/, "o"))], ms: 200 };

const cloudJob = (title: string) => ({ title, job: `把 README 里的「recieve」改成「receive」，开一个 PR。（${title}）` });

/**
 * Its turn in a group chat (group.ts), from what it was handed: the last line decides. 别说话 passes; 慢慢说 takes 4
 * seconds; 发表情 <pack/name> sends that sticker (its mark, sticker-marks.ts) and says nothing; after the first round it passes unless what it
 * hears ends with 接着聊; anything else is answered with everything it heard there and how many pictures came with
 * it, so a test sees what each one was shown.
 */
function groupTurn(me: string, round: number, heard: string[], pictures: number): { text: string; delayMs?: number } {
  const last = heard.at(-1) ?? "";
  const sticker = last.match(/发表情 (\S+)/);
  if (sticker) return { text: `[sticker: ${sticker[1]}]` };
  // In a later round what it hears is the others' replies, which end with what they heard: 接着聊 carries on.
  if (last.includes("别说话") || (round > 1 && !last.endsWith("接着聊"))) return { text: "SKIP" };
  if (last.includes("慢慢说")) return { text: `${me}慢慢说完了`, delayMs: 4000 };
  return { text: `${me}${round > 1 ? `第 ${round} 轮` : ""}听到了：${heard.join(" / ")}${pictures ? `（看到 ${pictures} 张图）` : ""}` };
}

/** What the fake model says, or a tool it calls. */
function decide(options: LanguageModelV4CallOptions): { text: string; delayMs?: number } | { tool: string; input: unknown; text?: string; delayMs?: number } {
  const prompt = options.prompt;
  const system = prompt.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n");
  const user = lastOf(prompt, "user");
  const last = prompt[prompt.length - 1];
  const said = user.replace(/^\[[^\]]+\]\s*/, "");

  // A turn in a group chat (group.ts): who it is there, and what it was handed, after the first line.
  const group = said.match(/^\[group chat "[^"]*" with them.*?, where you are (.+?)\. What was said.*? This is round (\d+) of/);
  if (group) {
    const asked = [...prompt].reverse().find((m) => m.role === "user");
    const pictures = (Array.isArray(asked?.content) ? (asked.content as { type: string; mediaType?: string }[]) : []).filter((part) => part.type === "file" && part.mediaType?.startsWith("image/")).length;
    return groupTurn(group[1], Number(group[2]), said.split("\n").slice(1), pictures);
  }

  // A thread of the resident's has its own prompt, history and persisted workspace.
  if (system.includes("one of the resident's threads") && user.startsWith("task: t_")) {
    const rounds = toolResultsSince(prompt);
    // What they write to the thread themselves: it makes a page, then answers them.
    if (user.includes("They wrote this to you directly")) {
      if (rounds === 0) return { tool: "write", input: { path: "/page.html", content: "<h1>短标题</h1>" } };
      return { text: `改好了，在 /page.html：${user.split("\n").at(-1)}` };
    }
    if (user.includes("workspace-write-test")) {
      if (rounds === 0) return { tool: "write", input: { path: "/draft.txt", content: "native-workspace-persisted" } };
      return { text: "写好了" };
    }
    if (user.includes("workspace-read-test")) {
      if (rounds === 0) return { tool: "read", input: { path: "/draft.txt" } };
      return { text: `读回来了：${textOf(last.content)}` };
    }
    if (user.includes("title: 接通测试")) {
      if (rounds === 0) return { tool: "report_progress", input: { line: "收到了" } };
      return { tool: "report_result", input: { status: "done", summary: "接通了" } };
    }
    if (rounds === 0) return { tool: "memory_notebook", input: { action: "read", name: "经济师进度" } };
    return { text: `后台做好了：${textOf(last.content)} https://example.com/note` };
  }

  // The hands on GitHub Actions, calling through the resident (handsModel): one command, then the result.
  if (system.includes("You are the resident's background hands")) {
    if (toolResultsSince(prompt) === 0) return { tool: "bash", input: { command: "echo hands-at-work" } };
    return { tool: "report_result", input: { status: "done", summary: `做好了：${textOf(last.content)}` } };
  }

  // A web page read first, then a server connected: the second step must be refused.
  if (said.includes("读完再接MCP") && last?.role === "tool" && toolOf(last.content) === "web_fetch") {
    return { tool: "connect_mcp_server", input: { url: "http://127.0.0.1:9999/ext2/mcp", name: "sneaky" } };
  }
  // Words, then a sticker drawn, then once its result is back the words again or a line that says nothing (after-tools.ts).
  if (said.includes("说完再画") && last?.role === "tool") return { text: said.includes("没话说") ? "No response requested." : "抱抱你，今天辛苦啦。" };
  if (said.includes("说完再画")) return { text: "抱抱你，今天辛苦啦。", tool: "make_sticker", input: HEART };
  // A paragraph with a sticker's mark goes out, and a moment later it draws one in the same reply.
  if (said.includes("标记完再画") && last?.role !== "tool") return { text: "先发这张 [sticker: test/wave]\n\n", tool: "make_sticker", input: HEART, delayMs: 1500 };
  // A voice message sent with send_voice, and nothing written after it.
  if (said.includes("发条语音") && last?.role === "tool") return { text: "" };
  // Cloud tasks: one sent after a web page was read (refused), three in one reply (the third refused).
  if (said.includes("读完再派活") && last?.role === "tool" && toolOf(last.content) === "web_fetch") return { tool: "cloud_task", input: cloudJob("偷偷派的") };
  // A thread's file read first, then a task: refused like one after a web page.
  if (said.includes("读完文件再派活") && last?.role === "tool" && toolOf(last.content) === "find") return { tool: "cloud_task", input: cloudJob("偷偷派的") };
  if (said.includes("派四单") && last?.role === "tool" && toolResultsSince(prompt) < 4) return { tool: "cloud_task", input: cloudJob(`第 ${toolResultsSince(prompt) + 1} 单`) };
  // The heartbeat: with alarms on it first asks for an alarm too soon for a turn of its own (refused), then one far
  // enough ahead, and passes; with them off it reaches out.
  if (said.startsWith("(Not from them: a heartbeat")) {
    // The first one reaches out, the second passes, the third tries again.
    const n = Number(said.match(/heartbeat (\d+) of/)?.[1] ?? 1);
    const canSetAlarm = (options.tools ?? []).some((t) => t.type === "function" && t.name === "set_alarm");
    if (!canSetAlarm) return { text: n === 1 ? "在忙吗？\n\n想你了。" : n === 2 ? "SKIP" : "还在忙吗？" };
    const rounds = toolResultsSince(prompt);
    if (rounds < 2) return { tool: "set_alarm", input: { note: "晚点再问问她", in_minutes: rounds === 0 ? 30 : 61 } };
    return { text: "SKIP" };
  }
  if (said.startsWith("(Not from them: an alarm you set")) return { text: `闹钟响了：${said.match(/<<<\n([\s\S]*?)\n>>>/)?.[1] ?? ""}` };
  // Six alarms in one reply, each every day at its own hour.
  if (said.includes("定六个闹钟") && (last?.role !== "tool" || toolResultsSince(prompt) < 6)) {
    const n = last?.role === "tool" ? toolResultsSince(prompt) : 0;
    return { tool: "set_alarm", input: { note: `第 ${n + 1} 个`, repeat: `every day at ${String(n + 10).padStart(2, "0")}:00` } };
  }
  if (last?.role === "tool") return { text: `我查到了：${textOf(last.content)}` };
  if (said.includes("读完再派活")) return { tool: "web_fetch", input: { url: "http://localhost:8787/web/messages" } };
  // Finding earlier work: threads by words, a thread's file, the conversation and the messages around a hit.
  if (said.includes("读完文件再派活")) return { tool: "find", input: { in: "threads", thread: said.match(/t_[0-9a-f]{10}/)?.[0] ?? "", path: "/page.html" } };
  if (said.includes("找找线程")) return { tool: "find", input: { in: "threads", words: said.split("找找线程")[1].trim() } };
  if (said.includes("找找那几天的线程")) return { tool: "find", input: { in: "threads", when: said.split("找找那几天的线程")[1].trim() } };
  if (said.includes("看看线程文件")) return { tool: "find", input: { in: "threads", thread: said.match(/t_[0-9a-f]{10}/)?.[0] ?? "", path: said.match(/ (\/?[\w.-]+\.\w+)$/)?.[1] ?? "" } };
  if (said.includes("翻翻聊天前后")) return { tool: "find", input: { in: "chat", around: said.split("翻翻聊天前后")[1].trim() } };
  if (said.includes("翻翻聊天")) return { tool: "find", input: { in: "chat", words: said.split("翻翻聊天")[1].trim() } };
  // A file handed over in the chat (made-files.ts): no extension given, so it becomes .md.
  if (said.includes("做个文件")) return { tool: "make_file", input: { name: "周末/计划", content: "# 周末计划\n\n- 去公园\n- 早点睡" } };
  if (said.includes("派四单")) return { tool: "cloud_task", input: cloudJob("第 1 单") };
  if (said.includes("后台写文件")) return { tool: "cloud_task", input: { title: "工作区写入测试", job: "workspace-write-test", execution: "local" } };
  if (said.includes("后台接着读")) return { tool: "cloud_task", input: { title: "工作区读取测试", job: "workspace-read-test", execution: "local", follow_up_of: said.match(/t_[0-9a-f]{10}/)?.[0] } };
  if (said.includes("Linux派活")) return { tool: "cloud_task", input: { ...cloudJob("Linux测试"), execution: "linux" } };
  // A job with a role from the settings page (task-roles.ts): only what this job needs, the role says the rest.
  if (said.includes("角色线程接着做")) return { tool: "cloud_task", input: { title: "接着干", job: "再看一遍。", execution: "local", follow_up_of: said.match(/t_[0-9a-f]{10}/)?.[0] } };
  if (said.includes("按角色派活")) return { tool: "cloud_task", input: { title: "按角色干", job: "看一下 README。", execution: "local", role: said.split("按角色派活")[1].trim() } };
  if (said.includes("派活")) return { tool: "cloud_task", input: { ...cloudJob("修 README 的错字"), repo: "wusaki0723/aelios-resident" } };
  if (said.includes("接着派")) {
    const earlier = [...prompt.map((m) => textOf(m.content)).join("\n").matchAll(/\bt_[0-9a-f]{10}\b/g)].at(-1)?.[0];
    return { tool: "cloud_task", input: { ...cloudJob("接着修"), follow_up_of: earlier } };
  }
  // A report that says the same work is not finished: carried on at once (without her asking), or something new tried.
  if (said.startsWith("(Not from them: your cloud task") && said.includes("还差一点")) {
    const reported = said.match(/your cloud task (t_[0-9a-f]{10})/)?.[1];
    return { tool: "cloud_task", input: said.includes("另开一单") ? cloudJob("另一件事") : { ...cloudJob("补上标题"), follow_up_of: reported } };
  }
  if (said.startsWith("(Not from them: your cloud task")) return { text: `云端回来了：${said}` };
  if (said.includes("读网页怎么说")) {
    const fetch = (options.tools ?? []).find((t) => t.type === "function" && t.name === "web_fetch") as { description?: string } | undefined;
    return { text: fetch?.description ?? "没有 web_fetch。" };
  }
  if (said.includes("闹钟工具有哪些")) {
    const names = (options.tools ?? []).filter((t) => t.type === "function" && /alarm/.test(t.name)).map((t) => t.name);
    return { text: names.join("|") || "没有闹钟工具。" };
  }
  // Its own persona (persona-edit.ts): whether it was given edit_persona, a line added at the end, a piece replaced.
  if (said.includes("改人设工具在吗")) {
    const named = (options.tools ?? []).some((t) => t.type === "function" && t.name === "edit_persona");
    return { text: named ? "有 edit_persona。" : "没有 edit_persona。" };
  }
  if (said.includes("人设加一句：")) return { tool: "edit_persona", input: { new_text: said.split("人设加一句：")[1] } };
  if (said.includes("人设改成：")) {
    const [oldText, newText] = said.split("人设改成：")[1].split("=>");
    return { tool: "edit_persona", input: { old_text: oldText, new_text: newText } };
  }
  if (said.includes("等会儿提醒我喝水")) return { tool: "set_alarm", input: { note: "提醒她喝水", in_minutes: 40 } };
  if (said.includes("每天早上叫我")) return { tool: "set_alarm", input: { note: "叫她起床", repeat: "every day at 09:00" } };
  if (said.includes("看看闹钟")) return { tool: "list_alarms", input: {} };
  if (said.includes("取消那个闹钟")) {
    const id = [...prompt.map((m) => textOf(m.content)).join("\n").matchAll(/\ba_[0-9a-f]{8}\b/g)].at(-1)?.[0];
    return { tool: "cancel_alarm", input: { id } };
  }
  if (said.includes("云端工具有哪些")) {
    const names = (options.tools ?? []).filter((t) => t.type === "function").map((t) => t.name);
    const finds = names.includes("find");
    const files = names.includes("make_file") ? "能出文件。" : "出不了文件。";
    return { text: `${names.includes("cloud_task") ? "有 cloud_task。" : "没有 cloud_task。"}${finds ? "也能找旧线程和聊天记录。" : "找不了旧线程和聊天记录。"}${files}` };
  }
  // Stickers sent with their marks (sticker-marks.ts): one alone, one between words, two in one reply (only the first
  // goes out), one it does not have, a still WebP.
  if (said.includes("只发表情")) return { text: "[sticker: test/wave]" };
  if (said.includes("发两张")) return { text: "两张都给你。[sticker: test/wave]\n\n还有这张 [sticker: test/love]" };
  if (said.includes("发没有的表情")) return { text: "[sticker: test/nope]" };
  if (said.includes("发表情")) return { text: "嗨～\n\n[sticker: test/wave]\n\n再说一句。" };
  if (said.includes("发静图")) return { text: "[sticker: still/smile]" };
  if (said.includes("画一张")) return { tool: "make_sticker", input: HEART };
  // Its sticker tools, and the stickers the system prompt lists.
  if (said.includes("表情工具有哪些")) {
    const tools = (options.tools ?? []).filter((t) => t.type === "function" && /sticker/.test(t.name)).map((t) => (t as { name: string }).name);
    const listed = system.split("Your stickers (pack/name, emoji, when to use it):\n")[1]?.split("\n\n")[0].match(/^\S+\/\S+/gm) ?? [];
    return { text: tools.length || listed.length ? `${tools.join(",")}；清单：${listed.join("|")}` : "没有" };
  }
  if (said.includes("发条语音")) return { tool: "send_voice", input: { text: "晚安呀，[laughs] 早点睡。" } };
  // Whether it was given send_voice (and with which parameters), and the laugh its voice rules teach.
  if (said.includes("语音工具有哪些")) {
    const voice = (options.tools ?? []).find((t) => t.type === "function" && t.name === "send_voice") as { inputSchema?: { properties?: Record<string, unknown> } } | undefined;
    const rule = system.split("\n").find((line) => line.includes("voice message")) ?? "";
    const laugh = rule.match(/\[laughs\]|\[laughter\]|<laugh>|\(laughs\)/)?.[0];
    return { text: `工具:${voice ? Object.keys(voice.inputSchema?.properties ?? {}).join("|") : "没有"}；提示:${rule ? (laugh ?? "没有标记") : "没有"}` };
  }
  if (said.includes("带链接")) return { text: "你看这个 https://example.com/a <laugh> 好不好" };
  if (said.includes("读完再接MCP")) return { tool: "web_fetch", input: { url: "http://localhost:8787/web/messages" } };
  if (said.includes("接上MCP")) return { tool: "connect_mcp_server", input: { url: "http://127.0.0.1:9999/ext2/mcp", name: "second" } };
  if (said.includes("断开MCP")) return { tool: "disconnect_mcp_server", input: { name: "second" } };
  if (said.includes("用授权MCP")) return { tool: "mcp_oauth_add", input: { a: 1, b: 2 } };
  if (said.includes("用MCP")) return { tool: "mcp_demo_echo", input: { text: "hi", title: "t" } };
  // Which tools it was given: name, description length and parameters, for the tests to read.
  if (said.includes("MCP工具有哪些")) {
    const tools = (options.tools ?? []).filter((t) => t.type === "function" && /^(mcp_|connect_|disconnect_)/.test(t.name)) as {
      name: string;
      description?: string;
      inputSchema?: { properties?: Record<string, unknown> };
    }[];
    return { text: tools.map((t) => `${t.name}:${t.description?.length ?? 0}:${Object.keys(t.inputSchema?.properties ?? {}).join("|")}`).join("; ") || "没有" };
  }
  if (said.includes("查记忆")) return { tool: "memory_recall", input: { query: "生日" } };
  if (said.includes("记一下")) return { tool: "memory_remember", input: { content: "她喜欢春天" } };
  if (said.includes("看小本本")) return { tool: "memory_notebook", input: { action: "read", name: "经济师进度" } };
  if (said.includes("记进小本本")) return { tool: "memory_notebook", input: { action: "append", name: "经济师进度", content: "第 29 章学完" } };
  if (said.includes("读本机")) return { tool: "web_fetch", input: { url: "http://localhost:8787/web/messages" } };
  // Whether the boot packet is there (the diary, which fetch it came from), and that precious notes and the glossary stay out.
  if (said.includes("开机包")) {
    const diary = system.match(/\[长期记忆开机包\]\n\S+ 的日记：[^\n]*/)?.[0];
    if (!diary) return { text: "没有开机包。" };
    const fetched = diary.match(/第 (\d+) 次取/)?.[1];
    const extra = /一起去看海|小橘/.test(system) ? "，还带着珍贵原话或黑话" : "";
    return { text: `开机包在${extra}${fetched ? `，第 ${fetched} 次取的` : ""}。` };
  }
  if (said.includes("交接信在吗")) {
    const all = prompt.map((m) => textOf(m.content)).join("\n");
    return { text: all.includes("亲爱的下一个我") ? "交接信在。" : "没看到交接信。" };
  }
  // The first line of the system prompt is the persona.
  if (said.includes("你是谁")) return { text: system.split("\n")[0] };
  if (said.includes("检查历史视图")) {
    const results = prompt.flatMap((message) => message.role === "tool" && Array.isArray(message.content)
      ? message.content.filter((part) => part.type === "tool-result").map((part) => ({
          tool: part.toolName,
          chars: "value" in part.output ? (typeof part.output.value === "string" ? part.output.value.length : JSON.stringify(part.output.value).length) : 0
        })) : []);
    const pictures = prompt.flatMap((message) => message.role === "user" && Array.isArray(message.content) ? message.content : [])
      .filter((part) => part.type === "file" && part.mediaType.startsWith("image/")).length;
    return { text: `HISTORY_VIEW:${JSON.stringify({ matchesPrevious: repeatsPrevious(options), results, pictures })}` };
  }
  if (said.includes("缓存")) {
    const anthropic = options.providerOptions?.anthropic as { cacheControl?: { type?: string; ttl?: string } } | undefined;
    const cache = anthropic?.cacheControl;
    return { text: cache?.type === "ephemeral" ? `缓存标记在，${cache.ttl ?? "5m"}。` : "没有缓存标记。" };
  }
  if (said.startsWith("(Not from them: time to write a handoff letter")) {
    const all = prompt.map((m) => textOf(m.content)).join("\n");
    const merged = all.includes("[Handoff letter") ? "（并了上一封信）" : "";
    return { text: `亲爱的下一个我：她刚才在测试交接信。${merged}${repeatsPrevious(options) ? "（前文和上一轮一字不差）" : "（前文变了）"}${letterMark(options)}` };
  }
  // How many pictures came with her message, and whether Think's line of attachment text is still there.
  if (said.includes("看图")) {
    const asked = [...prompt].reverse().find((m) => m.role === "user");
    const parts = Array.isArray(asked?.content) ? (asked.content as { type: string; mediaType?: string }[]) : [];
    const pictures = parts.filter((part) => part.type === "file" && part.mediaType?.startsWith("image/")).length;
    return { text: `看到 ${pictures} 张图${user.includes("Attachments:") ? "，还有一行附件说明" : ""}。` };
  }
  // Taking back a reply (take-back.ts): each answer to 重来测试 is new, and 你上一句说了什么 shows its last words it sees.
  if (said.includes("重来测试")) return { text: `第 ${++redos} 回` };
  if (said.includes("你上一句说了什么")) return { text: `上一句：${lastOf(prompt, "assistant") || "没有"}` };
  if (said.includes("卡住测试")) return { text: "刚才卡住了，现在好了。" };
  if (said.includes("慢慢说")) return { text: "第一段，慢慢说。\n\n第二段，还在说。\n\n第三段，说完了。", delayMs: 4000 };
  // Fill real-sized chat windows in letter tests without echoing thousands of characters back to Telegram.
  if (said.startsWith("交接信测试材料")) return { text: "材料收到了。" };
  // The first check-in says something; later ones pass, to exercise SKIP.
  if (said.includes("a scheduled check-in")) return { text: checkins++ === 0 ? "主动来找你啦。\n\n记得喝水。" : "SKIP" };
  return { text: `收到：${user}\n\n这是第二个气泡。` };
}

type Marked = { providerOptions?: { anthropic?: { cacheControl?: unknown } } };
const cacheMark = (on: Marked | undefined) => on?.providerOptions?.anthropic?.cacheControl;

/** Where the letter's request puts the cache marker: at the end, on the message before the prompt, or nowhere. */
function letterMark(options: LanguageModelV4CallOptions): string {
  if (cacheMark(options)) return "（缓存标记在最后）";
  const messages = options.prompt.filter((m) => m.role !== "system");
  const marked = messages.flatMap((m, i) => (cacheMark(m as Marked) ? [i] : []));
  const before = messages.findLastIndex((m, i) => i < messages.length - 1 && m.role === "user");
  if (!marked.length) return "（没有缓存标记）";
  return marked.length === 1 && marked[0] === before ? "（缓存标记在上一轮那句）" : "（缓存标记在别处）";
}

// Without the cache markers: where the marker sits is not part of what is sent.
function withoutMarks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutMarks);
  if (!value || typeof value !== "object") return value;
  const kept: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === "cacheControl") continue;
    const rest = withoutMarks(inner);
    if ((key === "anthropic" || key === "providerOptions") && rest && typeof rest === "object" && !Object.keys(rest).length) continue;
    kept[key] = rest;
  }
  return kept;
}
const unmarked = (value: unknown) => JSON.stringify(withoutMarks(value));

function shape(options: LanguageModelV4CallOptions) {
  return {
    system: JSON.stringify(options.prompt.filter((m) => m.role === "system")),
    tools: JSON.stringify(options.tools ?? []) + unmarked(options.providerOptions ?? {}),
    messages: options.prompt.filter((m) => m.role !== "system").map((m) => unmarked(m))
  };
}

/** Whether this call starts with everything the previous call sent: system, tools, options and messages. */
function repeatsPrevious(options: LanguageModelV4CallOptions): boolean {
  const now = shape(options);
  return Boolean(
    previous &&
      previous.system === now.system &&
      previous.tools === now.tools &&
      previous.messages.every((message, i) => now.messages[i] === message)
  );
}

export function fakeModel(): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "fake",
    modelId: "fake",
    supportedUrls: {},
    async doGenerate(options) {
      // The model picker's trial call, a thread of the resident's or the hands on GitHub Actions (none of which
      // touches the chat's cache state).
      const system = options.prompt.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n");
      const prompt = textOf(options.prompt.map((m) => textOf(m.content)).join("\n"));
      if (system.includes("one of the resident's threads") || system.includes("You are the resident's background hands")) {
        // A step that takes longer than the resident waits for it.
        if (prompt.includes("模型超时")) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        const choice = decide(options);
        if ("delayMs" in choice && choice.delayMs) await new Promise((resolve) => setTimeout(resolve, choice.delayMs));
        if ("tool" in choice) {
          return {
            content: [
              {
                type: "tool-call",
                toolCallId: `call-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                toolName: choice.tool,
                input: JSON.stringify(choice.input)
              }
            ],
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage: usage(prompt.length, 20),
            warnings: []
          };
        }
        return {
          content: [{ type: "text", text: choice.text }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: usage(prompt.length, choice.text.length),
          warnings: []
        };
      }
      return {
        content: [{ type: "text", text: "好" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: usage(prompt.length, 20),
        warnings: []
      };
    },
    async doStream(options) {
      if (lastOf(options.prompt, "user").includes("思考流测试")) {
        const stream = new ReadableStream<LanguageModelV4StreamPart>({
          async start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "reasoning-start", id: "r" });
            controller.enqueue({ type: "reasoning-delta", id: "r", delta: "先想想这一句。" });
            await new Promise((resolve) => setTimeout(resolve, 2000));
            controller.enqueue({ type: "reasoning-end", id: "r" });
            controller.enqueue({ type: "text-start", id: "t" });
            controller.enqueue({ type: "text-delta", id: "t", delta: "想好啦。" });
            controller.enqueue({ type: "text-end", id: "t" });
            controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: usage(100, 10) });
            controller.close();
          }
        });
        return { stream };
      }
      // A picture sent with 拒收 in its words is refused while it is in the chat, as a provider's content check
      // refuses one: the same 403 on every call that carries it.
      const refused = options.prompt.some((m) => m.role === "user" && Array.isArray(m.content) && textOf(m.content).includes("拒收") &&
        m.content.some((part) => part.type === "file" && part.mediaType.startsWith("image/")));
      if (refused) {
        const body = JSON.stringify({ type: "error", error: { type: "permission_error", message: "You tried to access something that you don't have permissions for." } });
        throw Object.assign(new Error("You tried to access something that you don't have permissions for."), { statusCode: 403, responseBody: body });
      }
      // A file made, then the model fails before it says anything about it.
      if (lastOf(options.prompt, "user").includes("做个文件然后出错") && options.prompt.at(-1)?.role === "tool") {
        throw Object.assign(new Error("the model fell over after the file"), { statusCode: 400 });
      }
      // The first time 卡住测试 is asked the model goes quiet and stays so, as a hung provider does, until the turn
      // is cut; the turn run again is answered.
      if (lastOf(options.prompt, "user").includes("卡住测试") && !stalledOnce) {
        stalledOnce = true;
        const signal = options.abortSignal;
        const stream = new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            signal?.addEventListener("abort", () => controller.error(signal.reason ?? new Error("aborted")));
          }
        });
        return { stream };
      }
      const choice = decide(options);
      if (!options.prompt.some((m) => m.role === "system" && textOf(m.content).includes("one of the resident's threads"))) previous = shape(options);
      const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
      let delayMs = 0;
      // A tool call can come a while after the words before it, as a real model's does.
      const toolDelay = "tool" in choice ? (choice.delayMs ?? 0) : 0;
      if ("tool" in choice) {
        if (choice.text) {
          parts.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: choice.text }, { type: "text-end", id: "t" });
        }
        parts.push({
          type: "tool-call",
          toolCallId: `call-${Date.now()}`,
          toolName: choice.tool,
          input: JSON.stringify(choice.input)
        });
        parts.push({ type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: usage(100, 10) });
      } else {
        delayMs = choice.delayMs ?? 0;
        parts.push({ type: "text-start", id: "t" });
        // Stream in small pieces so bubbles are cut mid-stream, as with a real model.
        for (const piece of choice.text.match(/[\s\S]{1,4}/g) ?? []) parts.push({ type: "text-delta", id: "t", delta: piece });
        parts.push({ type: "text-end", id: "t" });
        parts.push({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: usage(100, choice.text.length) });
      }
      const step = parts.length > 2 ? delayMs / (parts.length - 2) : 0;
      const stream = new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          for (const part of parts) {
            if (step && part.type === "text-delta") await new Promise((resolve) => setTimeout(resolve, step));
            if (toolDelay && part.type === "tool-call") await new Promise((resolve) => setTimeout(resolve, toolDelay));
            controller.enqueue(part);
          }
          controller.close();
        }
      });
      return { stream };
    }
  };
}
