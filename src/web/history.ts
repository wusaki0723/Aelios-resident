// Only provider-returned reasoning and tool inputs/results belong in the web activity view.
// Never expose provider metadata (including signed thinking blocks), credentials, or raw requests.
export type HistoryPart = {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};
export type Activity =
  | { type: "reasoning"; text: string }
  | { type: "tool"; id: string; name: string; input: string; output?: string; state: string };

const MAX_DETAIL = 16000;
const SECRET = /^(authorization|cookie|set-cookie|.*(?:api[_-]?key|token|password|secret|signature))$/i;
export function detail(value: unknown): string {
  if (value == null) return "";
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value, (key, item) => SECRET.test(key) ? "[redacted]" : item, 2);
    return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}\n[内容较长，后面省略]` : text;
  } catch {
    return "[无法显示这段内容]";
  }
}

export function activityOf(parts: readonly HistoryPart[]): Activity[] {
  const activity: Activity[] = [];
  const calls = new Map<string, Extract<Activity, { type: "tool" }>>();
  for (const part of parts) {
    if (part.type === "reasoning" && part.text?.trim()) {
      activity.push({ type: "reasoning", text: part.text });
    } else if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
      const id = part.toolCallId ?? `tool_${activity.length}`;
      const call = calls.get(id) ?? {
        type: "tool" as const,
        id,
        name: part.toolName ?? part.type.slice(5),
        input: "",
        state: "input-streaming"
      };
      call.input = detail(part.input);
      call.state = part.state ?? (part.output !== undefined ? "output-available" : "input-available");
      if (part.output !== undefined || part.errorText) call.output = detail(part.errorText ?? part.output);
      if (!calls.has(id)) { calls.set(id, call); activity.push(call); }
    }
  }
  return activity;
}

/** A transient copy of the visible stream. It never changes the model's stored conversation. */
export class WebDraft {
  readonly parts: HistoryPart[] = [];
  private reasoningId: string | null = null;
  private textId: string | null = null;
  constructor(readonly id: string, readonly at: number, readonly via: "telegram" | "web" | "checkin") {}

  chunk(chunk: { type: string; [key: string]: unknown }): void {
    if (chunk.type === "reasoning-delta" || chunk.type === "text-delta") {
      const reasoning = chunk.type === "reasoning-delta";
      const id = String(chunk.id ?? "");
      const current = reasoning ? this.reasoningId : this.textId;
      let part = this.parts.at(-1);
      if (current !== id || part?.type !== (reasoning ? "reasoning" : "text")) {
        part = { type: reasoning ? "reasoning" : "text", text: "" };
        this.parts.push(part);
      }
      part.text = (part.text ?? "") + String(chunk.text ?? "");
      if (reasoning) this.reasoningId = id; else this.textId = id;
    } else if (chunk.type === "tool-call" || chunk.type === "tool-result" || chunk.type === "tool-error") {
      const id = String(chunk.toolCallId);
      let part = this.parts.find((p) => p.toolCallId === id);
      if (!part) {
        part = { type: "dynamic-tool", toolCallId: id, toolName: String(chunk.toolName ?? "tool") };
        this.parts.push(part);
      }
      if (chunk.input !== undefined) part.input = chunk.input;
      if (chunk.type === "tool-result") { part.output = chunk.output; part.state = "output-available"; }
      else if (chunk.type === "tool-error") { part.errorText = detail(chunk.error); part.state = "output-error"; }
      else part.state = "input-available";
    }
  }
}
