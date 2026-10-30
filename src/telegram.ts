// Telegram pieces the Think messenger does not do the way we want:
//   - bubbles: a blank line in the reply starts a new Telegram message, posted as soon as
//     the paragraph is finished, instead of one message edited as it streams;
//   - a sticker its reply names with a mark (sticker-marks.ts) goes right after its paragraph;
//   - a reply that goes out as one voice message instead (voice.ts);
//   - the Worker's own Bot API calls (slash commands, webhook setup, stickers, voice messages).

import { stickerMarks } from "./sticker-marks";

const DEFAULT_API_BASE = "https://api.telegram.org";
// sendMessage allows 4096 UTF-16 code units; leave room for markdown escapes.
const MAX_BUBBLE_CHARS = 3800;
const BUBBLE_BREAK = /\n[^\S\n]*\n\s*/;

/** Cut text over the Telegram limit at a newline or space. */
function cutLong(text: string): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > MAX_BUBBLE_CHARS) {
    const window = rest.slice(0, MAX_BUBBLE_CHARS);
    const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const at = cut > MAX_BUBBLE_CHARS / 2 ? cut : MAX_BUBBLE_CHARS;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Split a reply into bubbles at blank lines. */
export function splitIntoBubbles(text: string): string[] {
  return text.split(BUBBLE_BREAK).flatMap(cutLong);
}

type PostedMessage = { id: string; threadId?: string };
type StreamPart = string | { type: string; text?: string };

/** The parts of the Chat SDK Telegram adapter the bubble stream uses. */
export type BubbleAdapter = {
  postMessage(threadId: string, message: { markdown: string }): Promise<PostedMessage>;
  startTyping(threadId: string): Promise<void>;
  stream?: unknown;
};

/**
 * A reply to send as one voice message. `send` gives the voice message it became (null when none could be sent) and
 * whatever is still to be posted as text ("" for nothing).
 */
export type VoiceOut = {
  recording(): Promise<void>;
  send(text: string): Promise<{ posted: PostedMessage | null; text: string }>;
};

/**
 * What happens when a reply's text is all in. `keepLast` can drop its last bubble (the placeholder for a reply
 * with no words, when a sticker is the reply); `after` posts what goes after the words (a sticker). `voice` sends the
 * whole reply as one voice message instead of bubbles. `instead` gives the message that already was the reply (a
 * voice message from send_voice) when the text is only the placeholder: nothing is posted, and that message stands
 * for the reply. `sticker` posts the sticker a mark names (pack/name), null when it could not go; `nothing` is posted
 * when nothing at all went out (a reply that was only the mark of a sticker that could not go).
 */
export type BubbleEnd = {
  keepLast?(threadId: string, text: string): boolean;
  after?(threadId: string): Promise<PostedMessage | null>;
  voice?(threadId: string): VoiceOut | null;
  instead?(threadId: string, text: string): PostedMessage | null;
  sticker?(threadId: string, handle: string): Promise<PostedMessage | null>;
  nothing?: string;
};

// Telegram shows "recording a voice message" for about 5 seconds per call.
const RECORDING_REFRESH_MS = 4000;

/**
 * Replace the adapter's post-and-edit streaming with bubbles: each paragraph is
 * sent as its own message the moment the next one starts, and the typing
 * indicator comes back on while the next paragraph is being written.
 * A reply that goes out as voice is gathered whole and sent as one voice message, as text if that fails.
 */
export function useBubbles(adapter: BubbleAdapter, end: BubbleEnd = {}): void {
  adapter.stream = async (
    threadId: string,
    textStream: AsyncIterable<StreamPart>,
    options?: { signal?: AbortSignal }
  ): Promise<PostedMessage | null> => {
    let buffer = "";
    let last: PostedMessage | null = null;
    let stuck = false;
    const stick = async (handles: string[]) => {
      for (const handle of handles) {
        if (stuck || !end.sticker) return;
        const posted = await end.sticker(threadId, handle).catch(() => null);
        if (posted) [last, stuck] = [posted, true];
      }
    };
    const post = async (text: string) => {
      for (const bubble of splitIntoBubbles(text)) {
        const marked = stickerMarks(bubble);
        if (marked.text) last = await adapter.postMessage(threadId, { markdown: marked.text });
        await stick(marked.stickers);
      }
    };
    const voice = end.voice?.(threadId) ?? null;
    const recording = () => void voice?.recording().catch(() => undefined);
    recording();
    const timer = voice ? setInterval(recording, RECORDING_REFRESH_MS) : undefined;
    try {
      for await (const part of textStream) {
        if (options?.signal?.aborted) break;
        buffer += typeof part === "string" ? part : part.type === "markdown_text" ? (part.text ?? "") : "";
        // A voice message waits for the whole reply.
        if (voice) continue;
        for (let match = BUBBLE_BREAK.exec(buffer); match; match = BUBBLE_BREAK.exec(buffer)) {
          await post(buffer.slice(0, match.index));
          buffer = buffer.slice(match.index + match[0].length);
          void adapter.startTyping(threadId).catch(() => undefined);
        }
      }
      const instead = last ? null : (end.instead?.(threadId, buffer) ?? null);
      if (instead) last = instead;
      const keep = !instead && (end.keepLast?.(threadId, buffer) ?? true);
      if (keep && voice) {
        const marked = stickerMarks(buffer);
        const said = marked.text ? await voice.send(marked.text) : { posted: null, text: "" };
        if (said.posted) last = said.posted;
        clearInterval(timer);
        if (said.text) await post(said.text);
        await stick(marked.stickers);
      } else if (keep) await post(buffer);
      if (!options?.signal?.aborted && end.after) {
        const after = await end.after(threadId).catch(() => null);
        if (after) last = after;
        // The sticker that was to be the whole reply did not go out: say so after all.
        else if (!keep && !instead) await post(buffer);
      }
      if (!last && end.nothing && !options?.signal?.aborted) last = await adapter.postMessage(threadId, { markdown: end.nothing });
      return last;
    } finally {
      clearInterval(timer);
    }
  };
}

export type TelegramConfig = { token: string; apiBase?: string };

/** Where Telegram sends the bot's updates, on the resident's own address. */
export const TELEGRAM_WEBHOOK_PATH = "/messengers/telegram/webhook";

function apiBase(config: TelegramConfig): string {
  return config.apiBase?.trim() || DEFAULT_API_BASE;
}

async function call(config: TelegramConfig, method: string, payload: Record<string, unknown> | FormData, timeoutMs?: number): Promise<Response> {
  const form = payload instanceof FormData;
  return fetch(`${apiBase(config)}/bot${config.token}/${method}`, {
    method: "POST",
    headers: form ? undefined : { "content-type": "application/json" },
    body: form ? payload : JSON.stringify(payload),
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {})
  });
}

// What the settings page asks Telegram waits this long at most.
const ASK_TIMEOUT_MS = 8000;

type Answer<T> = { ok: boolean; result?: T; description?: string };

async function answer<T>(response: Response): Promise<Answer<T>> {
  return ((await response.json().catch(() => null)) as Answer<T> | null) ?? { ok: false, description: `HTTP ${response.status}` };
}

/** Her chat id in a private chat's thread id ("telegram:42"); null for anything else. */
export function chatIdOf(threadId: string): string | null {
  return threadId.match(/^telegram:(-?\d+)$/)?.[1] ?? null;
}

/** "record_voice" while a voice message is being made. */
export async function chatAction(config: TelegramConfig, chatId: string, action: "record_voice" | "typing"): Promise<void> {
  await call(config, "sendChatAction", { chat_id: chatId, action });
}

/**
 * One voice message (MP3, which Telegram shows as a voice message like OGG/Opus), and the id of the message it became.
 * Throws with Telegram's reason when it is refused, as for someone whose privacy settings let no one send them one.
 */
export async function sendVoice(config: TelegramConfig, chatId: string, voice: { audio: Uint8Array; seconds: number }): Promise<string> {
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("voice", new Blob([voice.audio], { type: "audio/mpeg" }), "voice.mp3");
  if (voice.seconds > 0) form.set("duration", String(Math.max(1, Math.round(voice.seconds))));
  const sent = await answer<{ message_id: number }>(await call(config, "sendVoice", form));
  if (!sent.ok || !sent.result) throw new Error(`Telegram: ${sent.description ?? "sendVoice failed"}`);
  return String(sent.result.message_id);
}

/** A file as a document (make_file), and the id of the message it became. */
export async function sendDocument(config: TelegramConfig, chatId: string, file: { name: string; type: string; bytes: Uint8Array }): Promise<string> {
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("document", new Blob([file.bytes], { type: file.type }), file.name);
  const sent = await answer<{ message_id: number }>(await call(config, "sendDocument", form));
  if (!sent.ok || !sent.result) throw new Error(`Telegram: ${sent.description ?? "sendDocument failed"}`);
  return String(sent.result.message_id);
}

/** How a file goes to a chat: as a sticker (WebM, WebP, TGS), an animation (GIF) or a photo. */
export type MediaKind = "sticker" | "animation" | "photo";

export function mediaKindOf(type: string): MediaKind {
  if (type === "image/gif") return "animation";
  if (type === "video/webm" || type === "image/webp" || type === "application/x-tgsticker") return "sticker";
  return "photo";
}

const EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/webm": "webm",
  "application/x-tgsticker": "tgs"
};

type SentMedia = {
  message_id: number;
  sticker?: { file_id: string };
  animation?: { file_id: string };
  document?: { file_id: string };
  photo?: { file_id: string }[];
};

/**
 * A sticker, GIF or picture to a chat: by the file id Telegram already has, or uploaded. Returns the posted
 * message and the file id to send it by next time.
 */
export async function sendMedia(
  config: TelegramConfig,
  chatId: string,
  media: { kind: MediaKind; fileId?: string; file?: { bytes: Uint8Array; type: string }; emoji?: string }
): Promise<{ messageId: number; fileId: string | null } | { error: string }> {
  const method = { sticker: "sendSticker", animation: "sendAnimation", photo: "sendPhoto" }[media.kind];
  let payload: Record<string, unknown> | FormData;
  if (media.fileId) payload = { chat_id: chatId, [media.kind]: media.fileId };
  else if (media.file) {
    payload = new FormData();
    payload.set("chat_id", chatId);
    const name = `sticker.${EXTENSIONS[media.file.type] ?? "bin"}`;
    payload.set(media.kind, new Blob([media.file.bytes], { type: media.file.type }), name);
    if (media.kind === "sticker" && media.emoji) payload.set("emoji", media.emoji);
  } else return { error: "nothing to send" };
  const sent = await answer<SentMedia>(await call(config, method, payload));
  if (!sent.ok || !sent.result) return { error: sent.description ?? `${method} failed` };
  const result = sent.result;
  const fileId = result.sticker?.file_id ?? result.animation?.file_id ?? result.document?.file_id ?? result.photo?.at(-1)?.file_id ?? null;
  return { messageId: result.message_id, fileId };
}

export type TelegramSticker = {
  file_id: string;
  emoji?: string;
  is_animated?: boolean;
  is_video?: boolean;
  thumbnail?: { file_id: string };
};

export type TelegramStickerSet = { name: string; title: string; sticker_type?: string; stickers: TelegramSticker[] };

export async function getStickerSet(config: TelegramConfig, name: string): Promise<TelegramStickerSet | { error: string }> {
  const set = await answer<TelegramStickerSet>(await call(config, "getStickerSet", { name }));
  return set.ok && set.result ? set.result : { error: set.description ?? "getStickerSet failed" };
}

/** A file the bot can see, downloaded; null when it is gone or larger than `limit`. */
export async function downloadFile(config: TelegramConfig, fileId: string, limit: number): Promise<Uint8Array | null> {
  const file = await answer<{ file_path?: string; file_size?: number }>(await call(config, "getFile", { file_id: fileId }));
  const path = file.result?.file_path;
  if (!file.ok || !path || (file.result?.file_size ?? 0) > limit) return null;
  const response = await fetch(`${apiBase(config)}/file/bot${config.token}/${path}`);
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length && bytes.length <= limit ? bytes : null;
}

/** Plain text from the Worker itself (slash command answers); `bubbles: false` keeps blank lines in one message. */
export async function sendBubbles(
  config: TelegramConfig,
  chatId: string,
  text: string,
  { bubbles = true }: { bubbles?: boolean } = {}
): Promise<void> {
  const parts = bubbles ? splitIntoBubbles(text) : cutLong(text);
  for (const bubble of parts) {
    const response = await call(config, "sendMessage", { chat_id: chatId, text: bubble });
    if (!response.ok) console.error("tg: sendMessage failed", { status: response.status });
  }
}

export const COMMANDS = [
  { command: "status", description: "看模型、对话长度和交接信" },
  { command: "letter", description: "看最近一封交接信" },
  { command: "handoff", description: "现在就写交接信，把旧聊天收起来" }
];

/** The text on the bot's menu button that opens the web page as a Mini App. */
export const MENU_BUTTON_TEXT = "打开网页";

/**
 * Points the webhook here and lists the commands. With `miniAppUrl` (it must be https), the bot's default menu
 * button opens that page as a Mini App; without, the menu button is left alone.
 */
export async function setWebhook(
  config: TelegramConfig,
  url: string,
  secret: string,
  { miniAppUrl }: { miniAppUrl?: string } = {}
): Promise<Record<string, unknown>> {
  const webhook = await call(config, "setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message"]
  });
  return { setWebhook: await webhook.json(), ...(await setMenu(config, miniAppUrl)) };
}

/** The commands, and with `miniAppUrl` (https) the default menu button opening it as a Mini App. Telegram's answers. */
export async function setMenu(config: TelegramConfig, miniAppUrl?: string): Promise<{ setMyCommands: Answer<true>; setChatMenuButton?: Answer<true> }> {
  const setMyCommands = await answer<true>(await call(config, "setMyCommands", { commands: COMMANDS }));
  if (!miniAppUrl) return { setMyCommands };
  const menu = await call(config, "setChatMenuButton", { menu_button: { type: "web_app", text: MENU_BUTTON_TEXT, web_app: { url: miniAppUrl } } });
  return { setMyCommands, setChatMenuButton: await answer<true>(menu) };
}

/** Who the token belongs to: the bot's @username, or what Telegram said was wrong with the token. */
export async function getMe(config: TelegramConfig): Promise<{ username: string } | { error: string }> {
  try {
    const me = await answer<{ username?: string }>(await call(config, "getMe", {}, ASK_TIMEOUT_MS));
    return me.ok && me.result?.username ? { username: me.result.username } : { error: me.description ?? "getMe failed" };
  } catch (error) {
    return { error: `Telegram could not be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Where the bot's updates go now, and the last error Telegram had delivering one. */
export async function webhookInfo(config: TelegramConfig): Promise<{ url: string; lastError: string | null; lastErrorAt: number | null } | { error: string }> {
  try {
    const info = await answer<{ url?: string; last_error_message?: string; last_error_date?: number }>(await call(config, "getWebhookInfo", {}, ASK_TIMEOUT_MS));
    if (!info.ok || !info.result) return { error: info.description ?? "getWebhookInfo failed" };
    const at = info.result.last_error_date;
    return { url: info.result.url ?? "", lastError: info.result.last_error_message ?? null, lastErrorAt: at ? at * 1000 : null };
  } catch (error) {
    return { error: `Telegram could not be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The bot stops sending updates here (its token is being taken off). */
export async function deleteWebhook(config: TelegramConfig): Promise<void> {
  await call(config, "deleteWebhook", {}).catch(() => undefined);
}

/** The parts of a Telegram update the Worker reads before handing it to the resident. */
export type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    from?: { id?: number; is_bot?: boolean; username?: string };
    chat?: { id?: number | string; type?: string };
  };
};

/** "/status" or "/status@my_bot" → "status"; anything else → null. */
export function commandOf(text: string | undefined): string | null {
  const match = text?.trim().match(/^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i);
  return match ? match[1].toLowerCase() : null;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.byteLength !== right.byteLength) return false;
  return crypto.subtle.timingSafeEqual(left, right);
}

/** TG_ALLOWED: comma-separated chat ids and/or @usernames. Empty lets nobody in. */
export function isAllowed(allowed: string | undefined, chatId: string, username: string | undefined): boolean {
  const entries = (allowed ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (entries.includes(chatId)) return true;
  return Boolean(username && entries.includes(`@${username.toLowerCase()}`));
}
