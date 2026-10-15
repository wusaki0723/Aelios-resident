// The resident: one Think agent in one Durable Object. Telegram and the web page
// are two doors into the same conversation.

import { AsyncLocalStorage } from "node:async_hooks";
import {
  Think,
  type ChatOptions,
  type ChunkContext,
  type ToolCallResultContext,
  type ChatResponseResult,
  type MessageMetadataCallback,
  type SessionMessage,
  type ThinkModel,
  type ThinkScheduledTask,
  type ThinkScheduledTasks,
  type ThinkSession,
  type StepContext,
  type StreamCallback,
  type TurnConfig,
  type TurnContext
} from "@cloudflare/think";
import {
  defaultChatSdkEvent,
  type MessengerConcurrency,
  type MessengerContext,
  type MessengerEvent,
  type NormalizedMessengerDefinition,
  type ThinkMessengers
} from "@cloudflare/think/messengers";
import telegramMessenger from "@cloudflare/think/messengers/telegram";
import { webSearchTool } from "agents/websearch/ai-sdk";
import { generateText, type ToolSet, type UIMessage } from "ai";
import { aeliosConfig, fetchBoot, ingest, memoryTools, pin } from "./aelios";
import { fakeModel } from "./fake-model";
import { CHAT_RULES, DEFAULT_PERSONA, SKIP, checkinPrompt, isCheckin, isNote, letterPrompt, stamp } from "./prompts";
import { claudeOnRunPath } from "./claude-run";
import { cleaned, describe, fieldOf, withSaved, type ConfigField } from "./config";
import { customModel, isCustom } from "./custom";
import { foldIntoLetter, tokensOf } from "./fold";
import { withPictures, type Download } from "./pictures";
import { splitIntoBubbles, useBubbles, type BubbleAdapter } from "./telegram";
import { DEFAULT_COMPRESS_MODEL, type Compressor } from "./web/compress";
import { readerFor, webFetchTool, webFetchVia, type Page, type PageCache } from "./web/fetch";
import { searchEngines, searchSource } from "./web/search";
import { MEMORY_HEADER, aeliosModel } from "./via-aelios";
import { activityOf, WebDraft, type Activity } from "./web/history";

// Used until a model is picked on the web page. Free on the Workers Free plan.
const DEFAULT_MODEL = "@cf/zai-org/glm-4.7-flash";
const PERSONA_MAX_CHARS = 30000;
// How many earlier personas the web page can bring back.
const PERSONA_VERSIONS = 10;
// How many models that passed their trial call the web page's picker lists first.
const RECENT_MODELS = 8;
const BOOT_REFRESH_MS = 6 * 60 * 60 * 1000;
// How long a page web_fetch read is kept, so asking about it again costs no second fetch.
const PAGE_KEEP_MS = 60 * 60 * 1000;
// Claude models ("anthropic/…") go out on Anthropic's Messages API, where this asks for prompt caching:
// persona, rules, boot packet and the earlier turns are read from cache on the next turn, for an hour by
// default (CACHE_TTL=5m for five minutes; an hour costs 2x the input price to write, five minutes 1.25x).
// Other providers ignore options under "anthropic".
function promptCache(env: Env) {
  const ttl = env.CACHE_TTL?.trim() === "5m" ? "5m" : "1h";
  return { anthropic: { cacheControl: { type: "ephemeral", ttl } } };
}

/** Minutes of quiet after which the letter is written, while the conversation is still in the cache. 0 = never. */
function idleMinutes(env: Env): number {
  const ttl = env.CACHE_TTL?.trim() === "5m" ? 5 : 60;
  const setting = env.LETTER_IDLE_MINUTES?.trim().toLowerCase();
  if (setting === "off") return 0;
  const minutes = Number(setting);
  // Later than the cache lasts, the letter would read the whole conversation at full price: keep it inside.
  if (setting && Number.isFinite(minutes) && minutes >= 0) return Math.min(minutes, ttl - 1);
  return ttl === 5 ? 4 : 55;
}

/** What to do about the two errors you get when Cloudflare's own billing cannot serve a model. */
function hintFor(reason: string): string {
  if (/unified billing/i.test(reason)) {
    return "（可以在这个 AI Gateway 的 Provider Keys 里存你自己的 key，别名 default，就不走 Cloudflare 的统一计费；或者填自己的供应商 custom/…，见 README）";
  }
  if (/unknown gateway provider/i.test(reason)) return "（自己的供应商请填 custom/模型名，并在设置页填好它的地址和 key）";
  return "";
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** One line of the web page's conversation view. */
export type WebLine = {
  id: string;
  role: "user" | "assistant";
  kind: "chat" | "letter";
  text: string;
  at: number | null;
  via: "telegram" | "web" | "checkin" | null;
  activity?: Activity[];
  pending?: boolean;
};

/** Token use of the latest model call. Input includes the cached part. */
export type LastUsage = { at: number; input: number; cacheRead: number; cacheWrite: number; output: number };

/**
 * The model as the web page edits it. An empty model means the default is in use. memoryOff: on her latest turn
 * Aelios said this model is not one it keeps memory for, so nothing was recalled or recorded.
 */
export type WebModel = {
  model: string;
  at: number | null;
  fallback: string;
  recent: string[];
  lastUsage: LastUsage | null;
  memoryOff: boolean;
};

/** The persona as the web page edits it. An empty text means the default line is in use. */
export type WebPersona = {
  text: string;
  at: number | null;
  fallback: string;
  versions: { at: number; text: string }[];
};

const STAMP_PREFIX = /^\[\d\d-\d\d [^\]]*\]\s*/;
// What Think leaves of a picture once it has aged out of the conversation (its media eviction).
const EVICTED_PICTURE = /\[evicted image\/[^\]]*\]/g;

/** The letter in the letter turn's answer: its text after the last tool call, should the model have made one. */
function letterText(answer: readonly { parts?: readonly { type: string; text?: string }[] }[]): string {
  const parts = answer.flatMap((message) => message.parts ?? []);
  const lastTool = parts.findLastIndex((part) => part.type.startsWith("tool-") || part.type === "dynamic-tool");
  return parts
    .slice(lastTool + 1)
    .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
    .join("")
    .trim();
}

function textOf(message: { parts?: readonly { type: string; text?: string }[] } | undefined): string {
  return (message?.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

function usageLine(usage: LastUsage | null): string {
  if (!usage) return "上一次调用模型：还没有";
  const share = Math.round((usage.cacheRead / usage.input) * 100);
  return `上一次调用模型：输入 ${usage.input} token，其中缓存读 ${usage.cacheRead}（${share}%）、写 ${usage.cacheWrite}，输出 ${usage.output}`;
}

/** Put her local time in front of the first message of a burst, so the model knows when she wrote. */
function stampEvent(event: MessengerEvent, timeZone: string): MessengerEvent {
  const first = event.skipped?.[0] ?? event.message;
  if (first) first.text = `[${stamp(new Date(first.createdAt ?? Date.now()), timeZone)}] ${first.text}`;
  return event;
}

export class Resident extends Think<Env> {
  // Messages sent within DEBOUNCE_SECONDS of each other are answered as one turn.
  // A class field: the messenger runtime reads it before onStart.
  override messengerConcurrency: MessengerConcurrency = {
    strategy: "burst",
    debounceMs: num(this.env.DEBOUNCE_SECONDS, 3) * 1000
  };

  // When each reply started, for the web page (stored rows carry no time of their own).
  override messageMetadata: MessageMetadataCallback = ({ part }) => (part.type === "start" ? { at: Date.now() } : undefined);

  // Live activity is a web-only projection; the SDK remains the owner of the transcript.
  #drafts = new Map<string, WebDraft>();
  #draftActive: (() => boolean) | null = null;

  override onChunk({ chunk }: ChunkContext): void {
    const id = this.activeTurn?.requestId;
    if (id) this.#drafts.get(id)?.chunk(chunk as { type: string; [key: string]: unknown });
  }

  override afterToolCall(ctx: ToolCallResultContext): void {
    const draft = ctx.requestId ? this.#drafts.get(ctx.requestId) : undefined;
    draft?.chunk({
      type: ctx.success ? "tool-result" : "tool-error",
      toolCallId: ctx.toolCallId,
      toolName: ctx.toolName,
      input: ctx.input,
      ...(ctx.success ? { output: ctx.output } : { error: String(ctx.error) })
    });
  }

  get tz(): string {
    return this.cfg.TIME_ZONE?.trim() || "Asia/Singapore";
  }

  /** The settings in effect: those saved on the web page's settings page over the Worker's own (config.ts). */
  get cfg(): Env {
    this.#cfg ??= withSaved(this.env, this.savedConfig());
    return this.#cfg;
  }

  #cfg: Env | null = null;

  /** Settings saved on the settings page, by variable name. They live in res_settings as "env:<name>". */
  private savedConfig(): Record<string, string> {
    this.sql`CREATE TABLE IF NOT EXISTS res_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL)`;
    const rows = this.sql<{ key: string; value: string }>`SELECT key, value FROM res_settings WHERE key LIKE 'env:%'`;
    return Object.fromEntries(rows.map((row) => [row.key.slice(4), row.value]));
  }

  override getModel(): ThinkModel {
    return this.chatModel(this.savedModel() || this.defaultModel);
  }

  /** The model picked on the web page, or "" for the default. */
  private savedModel(): string {
    const saved = this.settings("model");
    if (saved) return saved.value;
    // The model used to be the MODEL variable: carry it over once, so the switch does not drop back to the default.
    const old = this.env.MODEL?.trim();
    if (old) this.saveSetting("model", old);
    return old ?? "";
  }

  /** Local tests run on a scripted model, which also becomes a valid choice there. */
  private get defaultModel(): string {
    return this.env.FAKE_MODEL === "true" ? "fake" : DEFAULT_MODEL;
  }

  /**
   * The model the conversation runs on. With Aelios connected it goes out through Aelios, which recalls and
   * records (via-aelios.ts); without, as the id says (Workers AI, AI Gateway, or your own provider).
   */
  private chatModel(id: string, { auxiliary = false } = {}): ThinkModel {
    if (id === "fake" && this.env.FAKE_MODEL === "true") return fakeModel();
    const memory = aeliosConfig(this.cfg);
    if (!memory) return this.modelFor(id);
    // What Aelios did about memory on her turn, kept so the web page and /status can say when it is off.
    const report = (status: string) => {
      this.ctx.waitUntil(this.ctx.storage.put("aelios_memory", { status, model: id, at: Date.now() }));
    };
    return aeliosModel(memory, id, { auxiliary, report });
  }

  /** Whether Aelios kept no memory on her latest turn with the model now in use. */
  private async memoryOff(): Promise<boolean> {
    if (!aeliosConfig(this.cfg)) return false;
    const last = await this.ctx.storage.get<{ status: string; model: string }>("aelios_memory");
    return last?.status === "off" && last.model === (this.savedModel() || this.defaultModel);
  }

  /** A model id as Think takes it, called from here: your own provider's `custom/…` is built here (custom.ts). */
  private modelFor(id: string): ThinkModel {
    if (isCustom(id)) return customModel(this.cfg, id);
    return id === "fake" && this.env.FAKE_MODEL === "true" ? fakeModel() : id;
  }

  /** Small settings written on the web page (the model, the recently used ones), one row per key. */
  private settings(key: string): { value: string; at: number } | undefined {
    this.sql`CREATE TABLE IF NOT EXISTS res_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL)`;
    return this.sql<{ value: string; at: number }>`SELECT value, at FROM res_settings WHERE key = ${key}`[0];
  }

  private saveSetting(key: string, value: string): void {
    this.settings(key);
    this.sql`INSERT INTO res_settings (key, value, at) VALUES (${key}, ${value}, ${Date.now()})
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, at = excluded.at`;
  }

  override getGateway() {
    const id = this.cfg.AI_GATEWAY_ID?.trim();
    return id ? { id } : undefined;
  }

  // Claude on Cloudflare's run path: `system` as one string, no thinking from earlier turns (see claude-run.ts).
  override getAIBinding(): Ai {
    return claudeOnRunPath(super.getAIBinding());
  }

  // Think asks for this on every turn (nothing freezes it), so a persona saved on the web applies to the next message.
  override getSystemPrompt(): string {
    return `${this.personas(1)[0]?.text || DEFAULT_PERSONA}\n\n${CHAT_RULES}`;
  }

  /** Personas saved on the web page, newest first. */
  private personas(limit: number): { at: number; text: string }[] {
    this.sql`CREATE TABLE IF NOT EXISTS res_persona (at INTEGER NOT NULL, text TEXT NOT NULL)`;
    return this.sql<{ at: number; text: string }>`SELECT at, text FROM res_persona ORDER BY rowid DESC LIMIT ${limit}`;
  }

  override getMessengers(): ThinkMessengers {
    const token = this.env.TG_BOT_TOKEN?.trim();
    const secretToken = this.env.TG_WEBHOOK_SECRET?.trim();
    if (!token || !secretToken) return {};
    const definition = telegramMessenger({
      token,
      secretToken,
      userName: this.env.TG_BOT_USERNAME?.trim().replace(/^@/, "") || "resident_bot",
      apiBaseUrl: this.env.TG_API_BASE?.trim() || undefined,
      // Telegram and the web page share this agent's one conversation.
      conversation: "self",
      respondTo: ["direct-message"],
      delivery: {
        splitText: splitIntoBubbles,
        emptyResponseText: "（我好像没说出话来，再发一次？）",
        errorResponseText: "我这边出错了，没能回你。再发一次试试？",
        interruptedResponseText: "刚才回到一半断了，再发一次好吗？"
      },
      toEvent: (input) =>
        stampEvent(defaultChatSdkEvent({ ...definition, id: "telegram" } as NormalizedMessengerDefinition, input), this.tz)
    });
    const adapter = definition.adapter as unknown as BubbleAdapter & { downloadFile: Download };
    useBubbles(adapter);
    this.#telegramFile = (fileId) => adapter.downloadFile(fileId);
    return { telegram: definition };
  }

  /** Downloads a file she sent on Telegram (set by getMessengers). */
  #telegramFile: Download | null = null;

  /** A Telegram turn: the photos she sent go into her message as pictures (pictures.ts). */
  override async chatWithMessengerContext(
    userMessage: string | UIMessage,
    callback: StreamCallback,
    context: MessengerContext,
    options?: ChatOptions
  ): Promise<void> {
    if (!this.#telegramFile) this.getMessengers();
    const download = this.#telegramFile;
    const message = typeof userMessage === "string" || !download ? userMessage : await withPictures(userMessage, context, download);
    return super.chatWithMessengerContext(message, callback, context, options);
  }

  override getTools(): ToolSet {
    const tools: ToolSet = {};
    const memory = aeliosConfig(this.cfg);
    if (memory) Object.assign(tools, memoryTools(memory));
    const source = searchSource(this.cfg);
    if (source) {
      tools.web_search = webSearchTool({
        source,
        description: "Search the web for current information: news, facts, prices, events. Open a result with web_fetch.",
        maxDescriptionChars: 400
      });
    }
    if (this.webFetchOn()) tools.web_fetch = webFetchTool(readerFor(this.cfg, this.compressor(), this.pageCache()));
    return tools;
  }

  /**
   * The model web_fetch shrinks long pages with: WEB_FETCH_MODEL, any id the model picker takes. A Workers AI id
   * runs on Cloudflare here; any other goes through Aelios when it is connected (marked auxiliary, so nothing is
   * recorded), else through AI Gateway. Null when it is "off" or cannot be used.
   */
  private compressor(): Compressor | null {
    const name = this.cfg.WEB_FETCH_MODEL?.trim() || DEFAULT_COMPRESS_MODEL;
    const viaAelios = Boolean(aeliosConfig(this.cfg)) && !name.startsWith("@cf/");
    if (name.toLowerCase() === "off" || (!this.env.AI && !viaAelios && !isCustom(name))) return null;
    try {
      return { name, model: this.resolveModel(viaAelios ? this.chatModel(name, { auxiliary: true }) : this.modelFor(name)) };
    } catch (error) {
      console.error("web_fetch: WEB_FETCH_MODEL cannot be used", { name, error: String(error) });
      return null;
    }
  }

  private webFetchOn(): boolean {
    return this.cfg.WEB_FETCH?.trim().toLowerCase() !== "off";
  }

  /** Pages web_fetch read in the last hour, in this agent's SQLite. */
  private pageCache(): PageCache {
    this.sql`CREATE TABLE IF NOT EXISTS res_pages (url TEXT PRIMARY KEY, at INTEGER NOT NULL, page TEXT NOT NULL)`;
    return {
      get: (url) => {
        const [row] = this.sql<{ at: number; page: string }>`SELECT at, page FROM res_pages WHERE url = ${url}`;
        return row && Date.now() - row.at < PAGE_KEEP_MS ? (JSON.parse(row.page) as Page) : null;
      },
      put: (url, page) => {
        const now = Date.now();
        this.sql`DELETE FROM res_pages WHERE at < ${now - PAGE_KEEP_MS}`;
        this.sql`INSERT OR REPLACE INTO res_pages (url, at, page) VALUES (${url}, ${now}, ${JSON.stringify(page)})`;
      }
    };
  }

  override async beforeTurn(ctx: TurnContext): Promise<TurnConfig> {
    // A failed turn can finish before an assistant row exists, so no response hook is guaranteed.
    this.#drafts.clear();
    this.#draftActive = null;
    if (ctx.requestId && !this.#letterPromptId) {
      const via = ctx.messenger ? "telegram" : ctx.trigger === "scheduled" || ctx.trigger === "submission" ? "checkin" : "web";
      this.#drafts.set(ctx.requestId, new WebDraft(`live_${ctx.requestId}`, Date.now(), via));
      // activeTurn is async-context-local; a separate history RPC must check it inside the captured turn.
      const withinTurn = AsyncLocalStorage.snapshot();
      this.#draftActive = () => withinTurn(() => this.activeTurn?.requestId === ctx.requestId);
    }
    const thread = ctx.messenger?.thread;
    if (thread?.isDirectMessage && (await this.ctx.storage.get("tg_thread")) !== thread.id) {
      await this.ctx.storage.put("tg_thread", thread.id);
    }
    const boot = await this.boot();
    // Only our own tools: Think's workspace file tools would cost tokens every turn and do nothing here.
    const own = Object.keys(this.getTools());
    return {
      instructions: boot ? `${ctx.system}\n\n[长期记忆开机包]\n${boot}` : ctx.system,
      activeTools: Object.keys(ctx.tools).filter((name) => own.includes(name)),
      providerOptions: promptCache(this.cfg)
    };
  }

  /** Token use of the latest model step, so /status and the web page can show whether the prompt cache is hit. */
  override async onStepFinish(step: StepContext): Promise<void> {
    const usage = step.usage;
    if (!usage?.inputTokens) return;
    await this.ctx.storage.put<LastUsage>("last_usage", {
      at: Date.now(),
      input: usage.inputTokens,
      cacheRead: usage.inputTokenDetails?.cacheReadTokens ?? 0,
      cacheWrite: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
      output: usage.outputTokens ?? 0
    });
  }

  private async lastUsage(): Promise<LastUsage | null> {
    return (await this.ctx.storage.get<LastUsage>("last_usage")) ?? null;
  }

  /** Aelios' boot packet, fetched at most every six hours. */
  private async boot(): Promise<string> {
    const memory = aeliosConfig(this.cfg);
    if (!memory) return "";
    const cached = await this.ctx.storage.get<{ text: string; at: number }>("aelios_boot");
    // The letter turn keeps the packet the conversation already has, so its request still matches the cache.
    if (cached && (this.#letterPromptId || Date.now() - cached.at < BOOT_REFRESH_MS)) return cached.text;
    const text = await fetchBoot(memory);
    await this.ctx.storage.put("aelios_boot", { text, at: Date.now() });
    return text;
  }

  override configureSession(session: ThinkSession) {
    // No token limit: a letter is written when she has been quiet for a while (idleLetter) or on /handoff.
    return session
      .onCompaction(foldIntoLetter(() => this.keepRecentTokens(), () => this.letterTurn()))
      .onCompactionError((error) => console.error("letter: compaction failed", { error: String(error) }));
  }

  private keepRecentTokens(): number {
    return num(this.cfg.KEEP_RECENT_TOKENS, 6000);
  }

  /** Why the letter being written is written. Set while compact() runs. */
  #letterReason: "idle" | "handoff" = "handoff";
  /** The letter prompt's id while its turn runs, so onChatResponse and boot() can tell that turn apart. */
  #letterPromptId: string | null = null;

  /**
   * The handoff letter, written as one more turn of the same conversation: the request is the chat's own
   * (system prompt, tools, every earlier message, exactly as the last turn sent them) plus one prompt at the
   * end, so all of it is read from the prompt cache. The prompt and the letter are then taken out of the
   * conversation again, and compaction folds the older turns into the letter.
   */
  private async letterTurn(): Promise<string> {
    // She came back just as the quiet time ran out: no letter now, her turn plans the next one.
    if (this.#letterReason === "idle" && this.activeTurn) return "";
    const prompt: UIMessage = {
      id: `letter_${crypto.randomUUID()}`,
      role: "user",
      parts: [{ type: "text", text: letterPrompt(stamp(new Date(), this.tz), this.#letterReason === "idle") }]
    };
    this.#letterPromptId = prompt.id;
    let status = "error";
    let answer: SessionMessage[] = [];
    try {
      status = (await this.saveMessages([prompt])).status;
    } finally {
      this.#letterPromptId = null;
      // Whatever happened, the prompt and its answer leave the conversation, or every later turn would carry them.
      answer = await this.takeOut(prompt.id).catch((error) => {
        console.error("letter: could not take the letter turn out", { error: String(error) });
        return [];
      });
    }
    if (status !== "completed") throw new Error(`the letter turn ended ${status}`);
    const letter = letterText(answer);
    if (!letter || letter === SKIP) return "";
    this.letters();
    this.sql`INSERT INTO res_letters (at, text) VALUES (${Date.now()}, ${letter})`;
    const memory = aeliosConfig(this.cfg);
    if (memory) this.ctx.waitUntil(ingest(memory, [{ role: "assistant", content: `（交接信）${letter}` }], "aelios-resident:letter"));
    return `[Handoff letter you wrote on ${stamp(new Date(), this.tz)}]\n${letter}`;
  }

  /** Delete one message and the answer right after it. Returns the answer. */
  private async takeOut(id: string): Promise<SessionMessage[]> {
    const history = await this.session.getHistory();
    const at = history.findIndex((message) => message.id === id);
    if (at < 0) return [];
    const answer: SessionMessage[] = [];
    for (const message of history.slice(at + 1)) {
      if (message.role === "user") break;
      answer.push(message);
    }
    await this.session.deleteMessages([id, ...answer.map((message) => message.id)]);
    return answer;
  }

  /** Fold the older turns into a letter now. False when there was nothing to fold. */
  private async writeLetter(reason: "idle" | "handoff"): Promise<boolean> {
    this.#letterReason = reason;
    // Cleared before, not after: a message that arrives while the letter is written sets it again.
    await this.ctx.storage.put("wrote_since_letter", false);
    try {
      return Boolean(await this.session.compact());
    } finally {
      this.#letterReason = "handoff";
    }
  }

  /**
   * After a turn: plan the idle letter. Her message moves it to LETTER_IDLE_MINUTES from now; a check-in
   * leaves a planned one where it is (it reads the cache, which keeps the cache alive), and only plans one
   * when none is planned, as when the letter's time came while the check-in was running.
   */
  private async planIdleLetter(fromThem: boolean): Promise<void> {
    const minutes = idleMinutes(this.cfg);
    const previous = await this.ctx.storage.get<string>("idle_letter");
    if (previous && !fromThem) return;
    if (previous) await this.cancelSchedule(previous).catch(() => false);
    if (!minutes || !(await this.ctx.storage.get<boolean>("wrote_since_letter"))) {
      await this.ctx.storage.delete("idle_letter");
      return;
    }
    const schedule = await this.schedule(minutes * 60, "idleLetter");
    await this.ctx.storage.put("idle_letter", schedule.id);
  }

  /**
   * Called LETTER_IDLE_MINUTES (55) after the last turn: she has gone quiet, and the conversation is
   * still in the one-hour cache, so the letter costs little to write. Nothing more happens until she writes again.
   */
  async idleLetter(): Promise<void> {
    await this.ctx.storage.delete("idle_letter");
    if (!(await this.ctx.storage.get<boolean>("wrote_since_letter"))) return;
    // Checked last: a turn that is running now plans its own letter when it ends.
    if (this.activeTurn) return;
    await this.writeLetter("idle");
  }

  private letters(): { at: number; text: string }[] {
    this.sql`CREATE TABLE IF NOT EXISTS res_letters (at INTEGER NOT NULL, text TEXT NOT NULL)`;
    return this.sql<{ at: number; text: string }>`SELECT at, text FROM res_letters ORDER BY at DESC LIMIT 1`;
  }

  /** One message to her Telegram chat, outside any turn. False when she has not written from Telegram yet. */
  private async toTelegram(text: string): Promise<boolean> {
    const thread = await this.ctx.storage.get<string>("tg_thread");
    if (!thread || !this.env.TG_BOT_TOKEN) return false;
    try {
      await this.deliverNotice({ markdown: text }, { channel: "telegram", thread });
      return true;
    } catch (error) {
      console.error("tg: notice failed", { error: String(error) });
      return false;
    }
  }

  override async onChatResponse(result: ChatResponseResult): Promise<void> {
    if (result.requestId) this.#drafts.delete(result.requestId);
    if (!this.#drafts.size) this.#draftActive = null;
    const before = this.userMessageBefore(result.message.id);
    // The letter turn: letterTurn() takes the answer and removes both messages.
    if (this.#letterPromptId && before?.id === this.#letterPromptId) return;
    const asked = before?.text ?? "";
    // Every message of hers starts with its time stamp, so a note prefix can only come from the system.
    const fromThem = Boolean(asked) && !isNote(asked);
    if (fromThem) await this.ctx.storage.put("wrote_since_letter", true);
    await this.planIdleLetter(fromThem);
    if (result.status !== "completed") return;
    const reply = textOf(result.message).trim();
    const trigger = this.activeTurn?.trigger;
    // A scheduled check-in has no messenger turn to reply into: post it ourselves.
    const proactive = trigger === "scheduled" || trigger === "submission";
    if (proactive && reply && reply !== SKIP) {
      for (const bubble of splitIntoBubbles(reply)) await this.toTelegram(bubble);
    }
    // Her turns are recorded by Aelios as they pass through it. A check-in answers no message of hers, so Aelios
    // leaves it out (via-aelios.ts): it is recorded here, as something said to her.
    const memory = aeliosConfig(this.cfg);
    if (proactive && memory && reply && reply !== SKIP) {
      this.ctx.waitUntil(ingest(memory, [{ role: "assistant", content: reply }], "aelios-resident:checkin"));
    }
  }

  private userMessageBefore(id: string): { id: string; text: string } | null {
    const messages = this.messages;
    const index = messages.findIndex((message) => message.id === id);
    for (let i = (index < 0 ? messages.length : index) - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") return { id: messages[i].id, text: textOf(messages[i]).trim() };
    }
    return null;
  }

  override getDefaultTimezone(): string {
    return this.tz;
  }

  override getScheduledTasks(): ThinkScheduledTasks {
    const schedule = this.cfg.CHECKIN_SCHEDULE?.trim();
    if (!schedule) return {};
    return {
      checkin: {
        schedule,
        prompt: () => checkinPrompt(stamp(new Date(), this.tz))
      } as ThinkScheduledTask
    };
  }

  /** Slash commands, answered by the Worker without a model turn. */
  async command(name: string): Promise<string> {
    switch (name) {
      case "start":
        return "在的，直接跟我说话就行。\n/status 看状态，/letter 看最近一封交接信，/handoff 现在就写交接信。";
      case "status":
        return this.status();
      case "letter": {
        const [latest] = this.letters();
        return latest ? `${stamp(new Date(latest.at), this.tz)} 写的：\n\n${latest.text}` : "还没写过交接信。";
      }
      case "handoff": {
        const before = this.letters()[0]?.at;
        await this.writeLetter("handoff");
        const [latest] = this.letters();
        if (!latest || latest.at === before) return "现在聊得还不多，没什么要收起来的。";
        return `交接信写好了，旧的聊天收起来了：\n\n${latest.text}`;
      }
      default:
        return "这个命令我不认识。可以用 /status、/letter、/handoff。";
    }
  }

  private async status(): Promise<string> {
    const history = await this.session.getHistory();
    const compactions = await this.session.getCompactions();
    const tokens = history.reduce((sum, message) => sum + tokensOf(message), 0);
    const model = this.savedModel() || this.defaultModel;
    const [persona] = this.personas(1);
    return [
      `模型：${model}`,
      persona?.text
        ? `人设：网页上填的，${persona.text.length} 字，${stamp(new Date(persona.at), this.tz)} 改的`
        : "人设：还没填，先用默认的一句（网页门右上角的铅笔）",
      `对话：${history.length} 条，约 ${tokens} token（最近 ${this.keepRecentTokens()} token 原样留着，更早的才收进交接信）`,
      `交接信：${idleMinutes(this.cfg) ? `没动静 ${idleMinutes(this.cfg)} 分钟后趁缓存还在写一封，` : ""}/handoff 随时写；缓存 ${promptCache(this.cfg).anthropic.cacheControl.ttl}`,
      `已写交接信：${compactions.length} 封`,
      usageLine(await this.lastUsage()),
      `长期记忆 Aelios：${
        !aeliosConfig(this.cfg)
          ? "关"
          : (await this.memoryOff())
            ? "接着，但这个模型不在 Aelios 那个身份的主模型里，上一句没想起旧事、也没记下来"
            : "开，聊天从 Aelios 过，想起旧事和记下来都由它做"
      }`,
      `查网页：搜索 ${searchEngines(this.cfg).join(" → ") || "关"}；读网页 ${this.webFetchOn() ? webFetchVia(readerFor(this.cfg, this.compressor())) : "关"}`,
      `主动找你：${this.cfg.CHECKIN_SCHEDULE?.trim() || "关"}`
    ].join("\n");
  }

  /** The conversation as the web page shows it: what the resident currently carries, letters included. */
  async webHistory(): Promise<WebLine[]> {
    const lines: WebLine[] = [];
    let via: WebLine["via"] = null;
    for (const message of await this.session.getHistory()) {
      const text = textOf(message).trim();
      const meta = message.metadata as { at?: number; messenger?: { message?: { createdAt?: string } } } | undefined;
      const sentAt = meta?.messenger?.message?.createdAt;
      const at = meta?.at ?? (sentAt ? new Date(sentAt).getTime() : null);
      if (message.id.startsWith("compaction_")) {
        lines.push({ id: message.id, role: "assistant", kind: "letter", text, at: null, via: null });
        continue;
      }
      if (message.role === "user") {
        if (isCheckin(text)) {
          via = "checkin";
          continue;
        }
        via = meta?.messenger ? "telegram" : "web";
        const pictures = message.parts.filter((part) => part.type === "file").length + (text.match(EVICTED_PICTURE)?.length ?? 0);
        const said = text.replace(EVICTED_PICTURE, "").trim().replace(STAMP_PREFIX, "");
        lines.push({ id: message.id, role: "user", kind: "chat", text: [said, ...Array(pictures).fill("[图片]")].filter(Boolean).join("\n"), at, via });
        continue;
      }
      if (message.role !== "assistant") continue;
      const activity = activityOf(message.parts);
      if (!text && !activity.length) continue;
      if (via === "checkin" && text === SKIP) continue;
      lines.push({ id: message.id, role: "assistant", kind: "chat", text, at, via, ...(activity.length ? { activity } : {}) });
    }
    // Only include a running draft when the SDK has not already exposed its assistant row.
    for (const [requestId, draft] of this.#drafts) {
      if (!this.#draftActive?.()) { this.#drafts.delete(requestId); continue; }
      if (draft.via === "checkin") continue;
      const finalUser = lines.findLastIndex((line) => line.role === "user");
      const partial = lines.slice(finalUser + 1).find((line) => line.role === "assistant" && line.kind === "chat");
      const activity = activityOf(draft.parts);
      const text = textOf({ parts: draft.parts });
      if (partial) {
        partial.pending = true;
        if (activity.length) partial.activity = activity;
        if (text) partial.text = text;
      } else if (text || activity.length) {
        lines.push({ id: draft.id, role: "assistant", kind: "chat", text, at: draft.at, via: draft.via, activity, pending: true });
      }
    }
    return lines;
  }

  /** A message typed on the web page: one turn in the same conversation, answered there (not on Telegram). */
  async webSay(text: string): Promise<{ status: string }> {
    const said = text.trim().slice(0, 4000);
    if (!said) return { status: "empty" };
    const result = await this.saveMessages([
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: `[${stamp(new Date(), this.tz)}] ${said}` }],
        metadata: { at: Date.now() }
      }
    ]);
    return { status: result.status };
  }

  async webModel(): Promise<WebModel> {
    this.savedModel();
    const saved = this.settings("model");
    return {
      model: saved?.value ?? "",
      at: saved?.at ?? null,
      fallback: this.defaultModel,
      recent: this.recentModels(),
      lastUsage: await this.lastUsage(),
      memoryOff: await this.memoryOff()
    };
  }

  /** Models that passed their trial call here, newest first. */
  private recentModels(): string[] {
    try {
      const list: unknown = JSON.parse(this.settings("recent_models")?.value ?? "[]");
      return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  }

  /**
   * Pick the model from the web page. It is tried with one tiny call first, so a typo,
   * a model the plan does not include, or a missing key is reported here instead of in the chat.
   * Empty goes back to the default.
   */
  async webSetModel(id: string): Promise<WebModel | { error: string }> {
    const model = id.trim();
    if (model) {
      try {
        const result = await generateText({
          model: this.resolveModel(this.chatModel(model, { auxiliary: true })),
          // Shaped like a real turn (a system prompt and the cache marker), so a model that would fail in the chat fails here.
          system: "You are a test assistant.",
          prompt: "Reply with one word: ok",
          maxOutputTokens: 64,
          providerOptions: promptCache(this.cfg),
          abortSignal: AbortSignal.timeout(30_000)
        });
        if (result.response.headers?.[MEMORY_HEADER] === "off") {
          return { error: "这个模型能调通，但在 Aelios 里不是这个身份的主模型：从它那儿过不会想起旧事，也不会记下来。先在 Aelios 后台把它加进主模型，再换。" };
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { error: `这个模型用不了：${reason.slice(0, 300)}${hintFor(reason)}` };
      }
    }
    this.saveSetting("model", model);
    if (model) {
      const recent = [model, ...this.recentModels().filter((id) => id !== model)].slice(0, RECENT_MODELS);
      this.saveSetting("recent_models", JSON.stringify(recent));
    }
    return this.webModel();
  }

  /** The persona panel on the web page: the current persona and the ones before it. */
  async webPersona(): Promise<WebPersona> {
    const [current, ...older] = this.personas(PERSONA_VERSIONS + 1);
    const text = current?.text ?? "";
    // Each earlier persona once, skipping empties and the one in use (bringing one back saves it again).
    const seen = new Set([text, ""]);
    const versions = older.filter((version) => !seen.has(version.text) && Boolean(seen.add(version.text)));
    return { text, at: current?.at ?? null, fallback: DEFAULT_PERSONA, versions };
  }

  /** Save a persona from the web page. Empty goes back to the default line. */
  async webSetPersona(text: string): Promise<WebPersona | { error: string }> {
    const persona = text.trim();
    if (persona.length > PERSONA_MAX_CHARS) return { error: `人设最多 ${PERSONA_MAX_CHARS} 字` };
    if (persona !== (this.personas(1)[0]?.text ?? "")) {
      this.sql`INSERT INTO res_persona (at, text) VALUES (${Date.now()}, ${persona})`;
      this.sql`DELETE FROM res_persona WHERE rowid NOT IN (SELECT rowid FROM res_persona ORDER BY rowid DESC LIMIT ${PERSONA_VERSIONS + 1})`;
    }
    return this.webPersona();
  }

  /** The settings page: each setting, what is saved there and what the Worker has. Secrets only say whether they are set. */
  webConfig(): { fields: ConfigField[] } {
    return { fields: describe(this.env, this.savedConfig()) };
  }

  /**
   * Save one setting from the settings page; empty goes back to the Worker's own value. It applies from the
   * next message. A check-in schedule or time zone is armed right away, and one that cannot be armed is not kept.
   */
  async webSetConfig(key: string, raw: string): Promise<{ fields: ConfigField[] } | { error: string }> {
    const field = fieldOf(key);
    if (!field) return { error: "没有这个设置" };
    const result = cleaned(field, raw);
    if ("error" in result) return result;
    const before = this.savedConfig()[key];
    this.storeConfig(key, result.value);
    if (key === "CHECKIN_SCHEDULE" || key === "TIME_ZONE") {
      try {
        await this.internal_reconcileScheduledTasks();
      } catch (error) {
        this.storeConfig(key, before ?? "");
        await this.internal_reconcileScheduledTasks().catch(() => undefined);
        return { error: `排不上：${error instanceof Error ? error.message : String(error)}` };
      }
    }
    // A different Aelios has a different boot packet.
    if (key.startsWith("AELIOS_")) await this.ctx.storage.delete("aelios_boot");
    return this.webConfig();
  }

  private storeConfig(key: string, value: string): void {
    if (value) this.saveSetting(`env:${key}`, value);
    else this.sql`DELETE FROM res_settings WHERE key = ${`env:${key}`}`;
    this.#cfg = null;
  }

  /** Who may talk to the resident on Telegram (TG_ALLOWED as now in effect), for the Worker's check. */
  telegramAllowed(): string {
    return this.cfg.TG_ALLOWED ?? "";
  }

  /** Whether long-term memory is set up, for the web page. */
  hasMemory(): boolean {
    return Boolean(aeliosConfig(this.cfg));
  }

  /** The heart on the web page: keep a line in Aelios' precious memories. */
  async webPin(content: string): Promise<boolean> {
    const memory = aeliosConfig(this.cfg);
    return Boolean(memory && content.trim() && (await pin(memory, content.trim())));
  }

}
