// The waiting list: what needs the owner, or has news, in one fixed format (see the waiting-list spec in Aelios-desktop).
// It is computed when asked for, from asks, notes and each thread's newest task. It never writes into the conversation.
export const ASK_EXPIRES_MS = 7 * 86_400_000;
export const ITEM_DROPPED_MS = 14 * 86_400_000;
const LINE_MAX = 120;

export type WaitingKind = "ask" | "note" | "done" | "stuck";
export type WaitingItem = {
  id: string;
  kind: WaitingKind;
  thread: string;
  /** The task an answer goes to. */
  task: string;
  title: string;
  line: string;
  options: string[];
  recommend: string;
  at: number;
  expired: boolean;
};

export type WaitingInput = {
  /** Open asks of threads on the machine. */
  asks: { thread: string; task: string; key: string; question: string; options: string[]; recommend: string; at: number }[];
  /** Notes a thread left with its last receipt. */
  notes: { thread: string; task: string; key: string; text: string; at: number }[];
  /** Each thread's newest task. */
  threads: { id: string; taskId: string; title: string; status: string; runs: string; summary: string; choices: string[]; waiting: boolean; updatedAt: number }[];
  /** Ids of note, done and stuck items the owner has read. */
  seen: ReadonlySet<string>;
  now: number;
};

/** The first sentence of a text, as plain text, at most LINE_MAX characters. */
export function firstSentence(text: string): string {
  const flat = (text.trim().split("\n")[0] ?? "").replace(/\s+/g, " ").trim();
  const end = flat.search(/[.!?。！？](\s|$)/);
  const sentence = end >= 0 ? flat.slice(0, end + 1) : flat;
  return sentence.length > LINE_MAX ? `${sentence.slice(0, LINE_MAX - 1)}…` : sentence;
}

export function build({ asks, notes, threads, seen, now }: WaitingInput): WaitingItem[] {
  const title = new Map(threads.map((thread) => [thread.id, thread.title]));
  const items = new Map<string, WaitingItem>();
  const put = (item: WaitingItem) => {
    const old = items.get(item.id);
    if (!old || old.at <= item.at) items.set(item.id, item);
  };
  for (const ask of asks) {
    if (!title.has(ask.thread)) continue;
    const expired = now - ask.at > ASK_EXPIRES_MS;
    put({ id: `${ask.thread}:ask:${ask.key}`, kind: "ask", thread: ask.thread, task: ask.task, title: title.get(ask.thread)!, line: firstSentence(ask.question),
      options: expired ? [] : ask.options, recommend: expired ? "" : ask.recommend, at: ask.at, expired });
  }
  for (const thread of threads) {
    const base = { thread: thread.id, task: thread.taskId, title: thread.title, options: [], recommend: "", at: thread.updatedAt, expired: false };
    if (thread.waiting && thread.runs !== "machine") {
      const expired = now - thread.updatedAt > ASK_EXPIRES_MS;
      put({ ...base, id: `${thread.id}:ask:${thread.taskId}`, kind: "ask", line: firstSentence(thread.summary), options: expired ? [] : thread.choices, expired });
    } else if (thread.status === "done" || thread.status === "failed") {
      const kind = thread.status === "done" ? "done" : "stuck";
      put({ ...base, id: `${thread.id}:${kind}:${thread.updatedAt}`, kind, line: firstSentence(thread.summary) });
    }
  }
  // A thread keeps its newest note only.
  const newest = new Map<string, (typeof notes)[number]>();
  for (const note of notes) if (!newest.has(note.thread) || newest.get(note.thread)!.at < note.at) newest.set(note.thread, note);
  for (const note of newest.values()) {
    if (!title.has(note.thread)) continue;
    put({ id: `${note.thread}:note:${note.key}`, kind: "note", thread: note.thread, task: note.task, title: title.get(note.thread)!, line: firstSentence(note.text), options: [], recommend: "", at: note.at, expired: false });
  }
  return [...items.values()]
    .filter((item) => now - item.at <= ITEM_DROPPED_MS && (item.kind === "ask" || !seen.has(item.id)))
    .sort((a, b) => Number(b.kind === "ask") - Number(a.kind === "ask") || b.at - a.at);
}

/** The push for a new ask: the thread's title and the question. */
export const askPush = (item: WaitingItem) => ({ body: `${item.title}: ${item.line}`.slice(0, 160), tag: "ask" });
