// Aelios as long-term memory. The chat itself goes out through Aelios' model endpoint (via-aelios.ts), where
// Aelios recalls for her message and records the exchange. Besides that:
//   POST /v1/memory/recall   the memory_recall tool
//   POST /v1/memory/ingest   handoff letters and check-ins, which Aelios does not record as conversation
//   GET  /v1/memory_boot     yesterday's diary, added to the system prompt (precious notes and the glossary are
//                            left to Aelios' recall, which brings them in on the turns they matter to)
//   POST /mcp                remember, keep a moment, forget, learn a word, read the diary, the notebook: Aelios'
//                            own MCP tools, wrapped here with short descriptions so they cost few tokens per turn
// Unset AELIOS_URL or AELIOS_API_KEY and all of it quietly does nothing.

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { callMcpTool } from "./mcp";

export type AeliosConfig = {
  url: string;
  key: string;
  namespace: string;
  /** The identity set up in Aelios' admin page that the chat goes out as; "" for the key's first one. */
  identity: string;
};

const BOOT_MAX_CHARS = 3000;

export function aeliosConfig(env: Env): AeliosConfig | null {
  const url = env.AELIOS_URL?.trim().replace(/\/+$/, "");
  const key = env.AELIOS_API_KEY?.trim();
  if (!url || !key) return null;
  return {
    url,
    key,
    namespace: env.AELIOS_NAMESPACE?.trim() || "default",
    identity: env.AELIOS_IDENTITY?.trim().replace(/^\/+|\/+$/g, "") ?? ""
  };
}

async function aelios(config: AeliosConfig, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${config.url}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${config.key}`,
      "content-type": "application/json",
      ...init.headers
    }
  });
}

export type RecallHit = { id?: string; content: string; type?: string; score?: number };

/** Search Aelios' long-term memory. Throws when Aelios cannot be reached or answers with an error. */
export async function recall(config: AeliosConfig, query: string, k: number, signal?: AbortSignal): Promise<RecallHit[]> {
  const response = await aelios(config, "/v1/memory/recall", {
    method: "POST",
    body: JSON.stringify({ query, namespace: config.namespace, k }),
    signal
  });
  if (!response.ok) throw new Error(`memory unavailable (${response.status})`);
  const body = (await response.json()) as { data?: Partial<RecallHit>[] };
  return (body.data ?? []).filter((hit): hit is RecallHit => typeof hit.content === "string" && hit.content.trim() !== "");
}

const MCP_RESULT_MAX_CHARS = 4000;
// A notebook page is up to 20000 characters in Aelios. It comes back whole: a page cut short and then rewritten
// with `write` would lose its end.
const NOTEBOOK_RESULT_MAX_CHARS = 24000;

/** The memory tools the model gets: recall over REST, the rest through Aelios' MCP. */
export function memoryTools(config: AeliosConfig): ToolSet {
  const call = async (name: string, args: Record<string, unknown>, max = MCP_RESULT_MAX_CHARS): Promise<string> => {
    try {
      const text = await callMcpTool(`${config.url}/mcp`, config.key, name, { ...args, namespace: config.namespace });
      return text.length > max ? `${text.slice(0, max)}…` : text;
    } catch (error) {
      return `memory unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  return {
    memory_recall: tool({
      description: "Search long-term memory for something from before. Each hit starts with its [id].",
      inputSchema: z.object({ query: z.string().describe("What to look for, in a few words.") }),
      async execute({ query }) {
        let hits: RecallHit[];
        try {
          hits = await recall(config, query, 5);
        } catch (error) {
          return error instanceof Error ? error.message : "memory unavailable";
        }
        return hits.length ? hits.map((hit) => `- [${hit.id ?? "?"}] ${hit.content}`).join("\n") : "No matching memory.";
      }
    }),
    memory_remember: tool({
      description:
        "Save one self-contained sentence worth keeping: a fact about her, a plan, a promise, a correction. " +
        "To update a memory, pass its id as replaces.",
      inputSchema: z.object({
        content: z.string(),
        replaces: z.string().optional().describe("Id of the memory this one updates.")
      }),
      execute: ({ content, replaces }) => call("remember", { content, ...(replaces ? { replaces } : {}) })
    }),
    memory_keep_moment: tool({
      description: "Keep a moment she will want to look back on, in her words.",
      inputSchema: z.object({ content: z.string() }),
      execute: ({ content }) => call("keep_moment", { content })
    }),
    memory_forget: tool({
      description: "Archive a memory that is wrong or that she wants gone, by id. It can be brought back in Aelios.",
      inputSchema: z.object({ id: z.string() }),
      execute: ({ id }) => call("forget", { id })
    }),
    memory_learn_word: tool({
      description: "Learn a private word, nickname or in-joke between you two.",
      inputSchema: z.object({ term: z.string(), definition: z.string() }),
      execute: ({ term, definition }) => call("learn_word", { term, definition })
    }),
    memory_read_diary: tool({
      description: "Read the diary of a day (YYYY-MM-DD) or a week (like 2026-W42).",
      inputSchema: z.object({ date: z.string().optional(), week: z.string().optional() }),
      execute: ({ date, week }) => call("read_diary", { ...(date ? { date } : {}), ...(week ? { week } : {}) })
    }),
    memory_notebook: tool({
      description:
        "Your notebook in long-term memory: named pages you keep up to date yourself, such as progress on something " +
        "long (what is done, weak spots, what is next). Pages are never recalled by themselves, so list them and read " +
        "the one you need. Read a page before you rewrite it; append adds a line at the end.",
      inputSchema: z.object({
        action: z.enum(["list", "read", "write", "append", "delete"]),
        name: z.string().optional().describe("The page, for every action but list."),
        content: z.string().optional().describe("write: the whole page. append: the line to add.")
      }),
      execute: ({ action, name, content }) =>
        call(
          "notebook",
          { action, ...(name ? { name } : {}), ...(content ? { content } : {}) },
          action === "read" ? NOTEBOOK_RESULT_MAX_CHARS : MCP_RESULT_MAX_CHARS
        )
    })
  };
}

export type IngestMessage = { role: "user" | "assistant"; content: string };

/** Record messages in Aelios and report whether they were accepted. */
export async function ingest(config: AeliosConfig, messages: IngestMessage[], source: string): Promise<boolean> {
  try {
    const response = await aelios(config, "/v1/memory/ingest", {
      method: "POST",
      body: JSON.stringify({
        namespace: config.namespace,
        conversation_id: `${config.namespace}:aelios-resident`,
        source,
        messages
      })
    });
    if (!response.ok) console.error("aelios: ingest failed", { status: response.status });
    return response.ok;
  } catch (error) {
    console.error("aelios: ingest failed", { error: String(error) });
    return false;
  }
}

export type BootData = {
  daily_log?: { date?: string; title?: string; summary?: string } | null;
};

/**
 * The boot packet as it goes into the system prompt: the latest day's diary, under its date. Precious notes and the
 * glossary stay out. Aelios' recall adds the ones that bear on her message to that turn, and every line kept here
 * would have to wait for a new cache window to change (cache-window.ts).
 */
export function bootText(data: BootData | undefined): string {
  const diary = data?.daily_log;
  if (!diary?.summary) return "";
  const text = `${diary.date ? `${diary.date} 的日记` : "昨天"}：${diary.summary}`;
  return text.length > BOOT_MAX_CHARS ? `${text.slice(0, BOOT_MAX_CHARS)}…` : text;
}

/** Aelios' boot packet as text ("" when there is none), or null when Aelios could not be asked. */
export async function fetchBoot(config: AeliosConfig): Promise<string | null> {
  try {
    const response = await aelios(config, `/v1/memory_boot?namespace=${encodeURIComponent(config.namespace)}`);
    if (!response.ok) {
      console.error("aelios: boot failed", { status: response.status });
      return null;
    }
    const { data } = (await response.json()) as { data?: BootData };
    return bootText(data);
  } catch (error) {
    console.error("aelios: boot failed", { error: String(error) });
    return null;
  }
}

/** Keep a line as a precious memory, the same as the heart in Aelios' admin page. */
export async function pin(config: AeliosConfig, content: string): Promise<boolean> {
  const response = await aelios(config, "/v1/precious", {
    method: "POST",
    body: JSON.stringify({ namespace: config.namespace, content, source: "human" })
  });
  return response.ok;
}
