// Which turns a handoff letter folds away. Think's own compaction counts about 4 characters a token,
// which suits English, but a Chinese character is about one token: with Chinese chat it kept roughly four
// times KEEP_RECENT_TOKENS and, in a normal day's chat, found nothing older to fold, so no letter was written.
import type { CompactionFunction, SessionMessage } from "agents/sessions";

/** The conversation's first messages stay as they are, as in Think's own compaction. */
const KEEP_HEAD = 3;
/** Role and framing of one message. */
const PER_MESSAGE = 4;
/** A picture she sent, about what Claude charges for a photo of the size Telegram sends. */
const PER_PICTURE = 1600;
/** Chinese, Japanese and Korean characters (with their punctuation and full-width forms): about a token each. */
const WIDE = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]|[\u{20000}-\u{3134f}]/gu;

/** Tokens in a piece of text: one for each wide character, one for each 4 other characters. */
export function tokensIn(text: string): number {
  let wide = 0;
  let wideLength = 0;
  for (const match of text.matchAll(WIDE)) {
    wide += 1;
    wideLength += match[0].length;
  }
  return Math.ceil(wide + (text.length - wideLength) / 4);
}

function tokensOfValue(value: unknown): number {
  if (value === undefined || value === null) return 0;
  return tokensIn(typeof value === "string" ? value : JSON.stringify(value));
}

/**
 * Tokens one message adds to a request: its text, pictures, and tool calls with their results. Thinking is left
 * out: earlier turns' thinking is not sent to Claude again (claude-run.ts).
 */
export function tokensOf(message: SessionMessage): number {
  let tokens = PER_MESSAGE;
  for (const part of message.parts as { type: string; text?: string; input?: unknown; output?: unknown }[]) {
    if (part.type === "text") tokens += tokensIn(part.text ?? "");
    else if (part.type === "file") tokens += PER_PICTURE;
    else if (part.type.startsWith("tool-") || part.type === "dynamic-tool") tokens += tokensOfValue(part.input) + tokensOfValue(part.output);
  }
  return tokens;
}

const isLetter = (message: SessionMessage) => message.id.startsWith("compaction_");

/**
 * Where the kept part starts: the most recent keepRecentTokens, at least her last message and its answer,
 * beginning with her message so no answer is kept without what it answers.
 */
export function keptFrom(messages: SessionMessage[], keepRecentTokens: number): number {
  let cut = messages.length;
  let kept = 0;
  while (cut > KEEP_HEAD) {
    const next = tokensOf(messages[cut - 1]);
    if (kept + next > keepRecentTokens && cut < messages.length) break;
    kept += next;
    cut -= 1;
  }
  while (cut > KEEP_HEAD && (messages[cut]?.role !== "user" || messages[cut - 1].role === "user")) cut -= 1;
  return cut;
}

/**
 * The compaction the resident runs: everything between the first messages and the kept part goes into the letter.
 * The budget is asked for each time, so a change on the settings page applies to the next letter. `short` is told
 * when the whole conversation still fits in the kept part, so there was nothing to fold (the heartbeat's moment).
 */
export function foldIntoLetter(
  budget: number | (() => number),
  write: (range: { fromMessageId: string; toMessageId: string }) => Promise<string>,
  short?: () => void
): CompactionFunction {
  return async (messages) => {
    const keepRecentTokens = typeof budget === "function" ? budget() : budget;
    const older = messages.slice(KEEP_HEAD, keptFrom(messages, keepRecentTokens)).filter((message) => !isLetter(message));
    if (!older.length) {
      console.log("letter: nothing older than the kept part to fold yet", {
        carried: messages.reduce((sum, message) => sum + tokensOf(message), 0),
        keepRecentTokens
      });
      short?.();
      return null;
    }
    const range = { fromMessageId: older[0].id, toMessageId: older[older.length - 1].id };
    const letter = await write(range);
    if (!letter.trim()) return null;
    return { ...range, summary: letter };
  };
}
