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

function lastOf(prompt: Prompt, role: string): string {
  for (let i = prompt.length - 1; i >= 0; i -= 1) if (prompt[i].role === role) return textOf(prompt[i].content);
  return "";
}

/** What the fake model says, or a tool it calls. */
function decide(options: LanguageModelV4CallOptions): { text: string; delayMs?: number } | { tool: string; input: unknown } {
  const prompt = options.prompt;
  const system = prompt.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n");
  const user = lastOf(prompt, "user");
  const last = prompt[prompt.length - 1];
  const said = user.replace(/^\[[^\]]+\]\s*/, "");

  if (last?.role === "tool") return { text: `我查到了：${textOf(last.content)}` };
  if (said.includes("查记忆")) return { tool: "memory_recall", input: { query: "生日" } };
  if (said.includes("记一下")) return { tool: "memory_remember", input: { content: "她喜欢春天" } };
  if (said.includes("读本机")) return { tool: "web_fetch", input: { url: "http://localhost:8787/web/messages" } };
  if (said.includes("开机包")) {
    return { text: system.includes("[长期记忆开机包]") && system.includes("一起去看海") ? "开机包在。" : "没有开机包。" };
  }
  if (said.includes("交接信在吗")) {
    const all = prompt.map((m) => textOf(m.content)).join("\n");
    return { text: all.includes("亲爱的下一个我") ? "交接信在。" : "没看到交接信。" };
  }
  // The first line of the system prompt is the persona.
  if (said.includes("你是谁")) return { text: system.split("\n")[0] };
  if (said.includes("缓存")) {
    const anthropic = options.providerOptions?.anthropic as { cacheControl?: { type?: string; ttl?: string } } | undefined;
    const cache = anthropic?.cacheControl;
    return { text: cache?.type === "ephemeral" ? `缓存标记在，${cache.ttl ?? "5m"}。` : "没有缓存标记。" };
  }
  if (said.startsWith("(Not from them: time to write a handoff letter")) {
    const all = prompt.map((m) => textOf(m.content)).join("\n");
    const merged = all.includes("[Handoff letter") ? "（并了上一封信）" : "";
    return { text: `亲爱的下一个我：她刚才在测试交接信。${merged}${repeatsPrevious(options) ? "（前文和上一轮一字不差）" : "（前文变了）"}` };
  }
  // How many pictures came with her message, and whether Think's line of attachment text is still there.
  if (said.includes("看图")) {
    const asked = [...prompt].reverse().find((m) => m.role === "user");
    const parts = Array.isArray(asked?.content) ? (asked.content as { type: string; mediaType?: string }[]) : [];
    const pictures = parts.filter((part) => part.type === "file" && part.mediaType?.startsWith("image/")).length;
    return { text: `看到 ${pictures} 张图${user.includes("Attachments:") ? "，还有一行附件说明" : ""}。` };
  }
  if (said.includes("慢慢说")) return { text: "第一段，慢慢说。\n\n第二段，还在说。\n\n第三段，说完了。", delayMs: 4000 };
  // The first check-in says something; later ones pass, to exercise SKIP.
  if (said.includes("a scheduled check-in")) return { text: checkins++ === 0 ? "主动来找你啦。\n\n记得喝水。" : "SKIP" };
  return { text: `收到：${user}\n\n这是第二个气泡。` };
}

function shape(options: LanguageModelV4CallOptions) {
  return {
    system: JSON.stringify(options.prompt.filter((m) => m.role === "system")),
    tools: JSON.stringify(options.tools ?? []) + JSON.stringify(options.providerOptions ?? {}),
    messages: options.prompt.filter((m) => m.role !== "system").map((m) => JSON.stringify(m))
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
      // Only the model picker's trial call generates.
      const prompt = textOf(options.prompt.map((m) => textOf(m.content)).join("\n"));
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
      const choice = decide(options);
      previous = shape(options);
      const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
      let delayMs = 0;
      if ("tool" in choice) {
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
            controller.enqueue(part);
          }
          controller.close();
        }
      });
      return { stream };
    }
  };
}
