// With Aelios connected, the chat goes out through Aelios' own model endpoint (https://<Aelios>/<identity>/v1),
// as any chat app pointed at Aelios does. Aelios recalls what fits her message and adds it to that request,
// records the exchange for Dream, and calls the model with the providers and keys set up there.
//   Claude        anthropic/… or any id with "claude" in it goes on the Messages API, so the prompt cache works:
//                 Aelios puts the cache marker on her message and its recall after it, so the earlier turns are
//                 still read from the cache.
//   anything else chat completions.
// The model goes under the name Aelios lists it by, or the one typed in, as it is: the resident is one more client of
// Aelios, and how a provider spells a version (claude-opus-5.5 or 5-5) is Aelios' business. Only the resident's own
// default, a Workers AI id written the way the AI binding takes it (@cf/…), goes under workers-ai/, as Aelios lists it.
// The system's own notes (the handoff letter, a check-in) and the trial call when a model is picked are marked
// auxiliary: Aelios neither recalls for them nor records them as something she said.
// On the Messages API the conversation's calls also ask for Claude's thinking to be shown and carry
// THINKING_EFFORT (thinking.ts).

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { AeliosConfig } from "./aelios";
import { withoutOldThinkingIn } from "./claude-run";
import { isNote } from "./prompts";
import { withThinking, type Effort } from "./thinking";

export const PURPOSE_HEADER = "x-aelios-purpose";
/** For a call that is not part of the conversation: Aelios passes it on without recalling or recording. */
export const AUXILIARY = { [PURPOSE_HEADER]: "auxiliary" };
/** Aelios says here whether it handled memory: "off" when the model is not one of the identity's main models. */
export const MEMORY_HEADER = "x-aelios-memory";
/**
 * Aelios tells exchanges apart by their request: the same request again is taken for the one it already recorded.
 * A reply asked for again (take-back.ts) sends the same request, so it carries a fresh id here to be recorded too.
 */
export const REQUEST_ID_HEADER = "x-aelios-request-id";

/** The model name as Aelios takes it: as picked or typed, a bare Workers AI id under workers-ai/. */
export function aeliosName(id: string): string {
  return id.startsWith("@cf/") ? `workers-ai/${id}` : id;
}

/**
 * Whether this is one of OpenAI's own reasoning models (o-series, GPT-5 and later, but not gpt-5-chat), which
 * refuse max_tokens and want max_completion_tokens. The AI SDK only knows them by their bare name, and through
 * Aelios they are called openai/…, so the resident swaps the field itself.
 */
export function takesCompletionTokens(name: string): boolean {
  const own = name.match(/^openai\/(.+)$/i)?.[1]?.toLowerCase();
  if (!own) return false;
  if (/^o\d+(?:-|$)/.test(own)) return true;
  const gpt = own.match(/^gpt-(\d+)(?:\.(\d+))?(?:-(.+))?$/);
  if (!gpt) return false;
  const chat = gpt[2] === undefined && (gpt[3]?.startsWith("chat") ?? false);
  return Number(gpt[1]) >= 5 && !chat;
}

/** Whether Aelios gets this model on the Messages API: Anthropic's, or any Claude through another provider. */
export function onMessages(id: string): boolean {
  const name = aeliosName(id).toLowerCase();
  return name.startsWith("anthropic/") || name.includes("claude");
}

export function aeliosBase(memory: AeliosConfig): string {
  return `${memory.url}${memory.identity ? `/${encodeURIComponent(memory.identity)}` : ""}/v1`;
}

/** One model in Aelios' own list (GET /v1/models), as the web page's picker takes it. */
export type AeliosModel = {
  id: string;
  /** Who it is from: the part before the first slash (openai, openrouter, custom-…, chatgpt). */
  owner: string;
  /** Whether a chat on it gets memory under this identity. Left out when Aelios did not say (an unlisted catalog). */
  main?: boolean;
};
export type AeliosModels = {
  models: AeliosModel[];
  /** The owner saved a model list in Aelios; otherwise this is the whole upstream catalog, which can be thousands. */
  curated: boolean;
};
const MODELS_MAX = 5000;

/** The usable entries of an OpenAI-style model list: an id once, and what Aelios said about memory for it. */
export function modelsOf(body: unknown): AeliosModel[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const models: AeliosModel[] = [];
  for (const entry of data) {
    const { id, owned_by: owner, aelios } = (entry ?? {}) as { id?: unknown; owned_by?: unknown; aelios?: unknown };
    if (typeof id !== "string" || !id.trim() || id.length > 200 || /\s/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const main = (aelios as { main?: unknown } | null | undefined)?.main;
    models.push({ id, owner: typeof owner === "string" ? owner : "", ...(typeof main === "boolean" ? { main } : {}) });
    if (models.length >= MODELS_MAX) break;
  }
  return models;
}

/**
 * Aelios' model list: the one the owner saved in its admin page, or else the upstream's whole catalog.
 * Throws when Aelios cannot be reached or refuses the key.
 */
export async function listModels(memory: AeliosConfig, signal?: AbortSignal): Promise<AeliosModels> {
  // Do not forward the key to a redirect target, even another path on the same origin.
  const response = await fetch(`${aeliosBase(memory)}/models`, { headers: { authorization: `Bearer ${memory.key}` }, signal, redirect: "manual" });
  if (!response.ok) throw new Error(`Aelios answered ${response.status}`);
  return { models: modelsOf(await response.json()), curated: response.headers.get("x-aelios-models") === "list" };
}

type Message = { role?: unknown; content?: unknown };

/** The text of the last message that was said rather than a tool result: hers, or one of the system's notes. */
export function lastSaid(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? (body.messages as Message[]) : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const { role, content } = messages[i] ?? {};
    if (role !== "user") continue;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((part: { type?: unknown; text?: unknown }) => part?.type === "text" && typeof part.text === "string")
      .map((part: { text: string }) => part.text)
      .join("\n");
    if (text) return text;
  }
  return "";
}

/** Whether a request to Aelios should be marked auxiliary: the turn answers one of the system's notes. */
export function isAuxiliary(body: Record<string, unknown>): boolean {
  return isNote(lastSaid(body).trimStart());
}

/** Told what Aelios did about memory on each of her turns (MEMORY_HEADER), so "off" can be shown to her. */
export type MemoryReport = (status: string) => void;

/** How the conversation's calls think (thinking.ts); left out for work outside it, such as shrinking a web page. */
export type Thinking = { effort: Effort | null };

/** The id a reply asked for again goes out with (REQUEST_ID_HEADER), or null. */
export type Redo = () => string | null;

function sender(messages: boolean, auxiliary: boolean, report?: MemoryReport, thinking?: Thinking, redo?: Redo, completionTokens = false): typeof fetch {
  return async (input, init) => {
    // Like every request to Aelios: the key is not carried to a redirect target.
    if (typeof init?.body !== "string") return fetch(input, { ...init, redirect: "manual" });
    let body = JSON.parse(init.body) as Record<string, unknown>;
    const headers = new Headers(init.headers);
    const hers = !auxiliary && !isAuxiliary(body);
    if (!hers) headers.set(PURPOSE_HEADER, "auxiliary");
    const again = redo?.();
    if (again) headers.set(REQUEST_ID_HEADER, again);
    // Claude's earlier thinking goes back without its blocks, for the reason in claude-run.ts.
    if (messages) body = withoutOldThinkingIn(body);
    if (messages && thinking) body = withThinking(body, thinking.effort);
    if (completionTokens && body.max_tokens !== undefined) {
      const { max_tokens, ...rest } = body;
      body = { ...rest, max_completion_tokens: rest.max_completion_tokens ?? max_tokens };
    }
    const response = await fetch(input, { ...init, headers, body: JSON.stringify(body), redirect: "manual" });
    const status = response.headers.get(MEMORY_HEADER);
    if (hers && status && report) report(status);
    return response;
  };
}

/**
 * A model id as a model that goes out through Aelios. `auxiliary` marks every call, for work outside the
 * conversation (shrinking a web page, the trial call); otherwise only turns that answer a system note are marked.
 */
export function aeliosModel(
  memory: AeliosConfig,
  id: string,
  { auxiliary = false, report, thinking, redo }: { auxiliary?: boolean; report?: MemoryReport; thinking?: Thinking; redo?: Redo } = {}
): LanguageModel {
  const name = aeliosName(id);
  const baseURL = aeliosBase(memory);
  if (onMessages(id)) return createAnthropic({ baseURL, apiKey: memory.key, fetch: sender(true, auxiliary, report, thinking, redo) })(name);
  const fetch = sender(false, auxiliary, report, undefined, redo, takesCompletionTokens(name));
  return createOpenAI({ baseURL, apiKey: memory.key, name: "aelios", fetch }).chat(name);
}
