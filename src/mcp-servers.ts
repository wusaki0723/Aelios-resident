// Other people's MCP servers, connected from the settings page or by the model when they ask for one in chat.
// The connection itself is Think's own MCP client (the agents SDK): it speaks Streamable HTTP or SSE, runs the
// OAuth sign-in when a server asks for one (the callback comes back to MCP_CALLBACK_PATH), keeps the connection
// in the Durable Object's storage and brings it back after hibernation. What is here turns each server's tools
// into ours: names that say which server they belong to, descriptions cut short (every tool's description goes
// out with every turn, so a long one is paid for again and again), and results cut to size.

import { jsonSchema, tool, type ToolSet } from "ai";

/** Where a server's OAuth sign-in comes back to; the Worker hands it to the resident. */
export const MCP_CALLBACK_PATH = "/mcp/callback";
export const MAX_MCP_SERVERS = 8;
/** Tools beyond this many, across all servers, are left out of the turn. */
export const MAX_MCP_TOOLS = 40;
/** Bounds for one server's persisted catalog, before it reaches DO storage. */
export const MAX_MCP_CATALOG_TOOLS = 200;
export const MAX_MCP_CATALOG_BYTES = 256 * 1024;
const DESCRIPTION_MAX_CHARS = 300;
const PARAM_DESCRIPTION_MAX_CHARS = 120;
export const MCP_RESULT_MAX_CHARS = 6000;
const TOOL_NAME_MAX = 64;

/** A tool as a connected server lists it. */
export type CatalogTool = { serverId: string; name: string; description?: string; inputSchema?: unknown };

/** A server as the settings page shows it. Never its key. */
export type McpServerView = {
  id: string;
  name: string;
  url: string;
  state: string;
  authUrl: string | null;
  error: string | null;
  tools: number;
  tokens: number;
  hasKey: boolean;
};

/** The server's address, if it is one the resident connects to: https, or http on this machine for local tests. */
export function checkServerUrl(raw: string): { url: string } | { error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { error: "地址不对，要填 https:// 开头的完整地址" };
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return { error: "只接 https:// 的地址" };
  if (url.username || url.password) return { error: "地址里别带账号密码，key 填在下面" };
  url.hash = "";
  return { url: url.href };
}

/** Addresses in a message as their origin only, so a key in a path or a query string stays out of the chat. */
export function hideUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>)\]]+/g, (found) => {
    const tail = found.match(/[.,;:!?。，；：]+$/)?.[0] ?? "";
    try {
      return `${new URL(found.slice(0, found.length - tail.length)).origin}/…${tail}`;
    } catch {
      return `…${tail}`;
    }
  });
}

/** A short ASCII id from what they called it, else from the address (mcp.notion.com → notion). */
export function serverIdFor(name: string | undefined, url: string): string {
  const slug = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24)
      .replace(/-+$/, "");
  const fromName = slug(name ?? "");
  if (/^[a-z]/.test(fromName)) return fromName;
  const hostname = new URL(url).hostname;
  if (hostname === "localhost" || /^[\d.]+$/.test(hostname)) return "local";
  const labels = hostname.split(".").filter((label) => !["mcp", "www", "api", "server"].includes(label));
  const host = slug(labels.length > 1 ? labels[labels.length - 2] : (labels[0] ?? ""));
  return /^[a-z]/.test(host) ? host : `mcp-${host || "server"}`;
}

/** The header a key goes out in: `Header-Name: value` as written, anything else as a bearer token. */
export function keyHeaders(key: string | undefined): Record<string, string> | undefined {
  const value = key?.trim();
  if (!value) return undefined;
  const named = value.match(/^([A-Za-z][A-Za-z0-9-]*):\s*(\S.*)$/);
  if (named && named[1].toLowerCase() !== "bearer") return { [named[1]]: named[2].trim() };
  return { Authorization: /^bearer\s/i.test(value) ? value : `Bearer ${value}` };
}

/** The first paragraph, cut at a sentence end where one is near enough. */
export function shorten(text: string | undefined, max = DESCRIPTION_MAX_CHARS): string {
  const first = (text ?? "").trim().split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const end = Math.max(...[". ", "。", "! ", "? ", "；", "; "].map((mark) => cut.lastIndexOf(mark)));
  return end > max / 2 ? cut.slice(0, end + 1).trim() : `${cut.trimEnd()}…`;
}

// Keywords whose value is a map of names to schemas: the names are parameters, not keywords.
const SCHEMA_MAPS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
const SCHEMA_LISTS = new Set(["anyOf", "allOf", "oneOf", "prefixItems"]);
const SCHEMA_ONE = new Set(["items", "additionalProperties", "not", "if", "then", "else", "contains", "propertyNames"]);
const DROPPED = new Set(["$schema", "$comment", "title", "examples"]);

/** A tool's input schema with every description cut short and the parts a model does not need dropped. */
export function trimSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (DROPPED.has(key)) continue;
    if (key === "description") {
      const text = typeof value === "string" ? shorten(value, PARAM_DESCRIPTION_MAX_CHARS) : "";
      if (text) out.description = text;
    } else if (SCHEMA_MAPS.has(key) && value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, inner]) => [name, trimSchema(inner)]));
    } else if (SCHEMA_LISTS.has(key) && Array.isArray(value)) {
      out[key] = value.map(trimSchema);
    } else if (SCHEMA_ONE.has(key)) {
      out[key] = trimSchema(value);
    } else {
      // enum, const, default, required and the rest are data: kept as they are.
      out[key] = value;
    }
  }
  return out;
}

function inputSchemaOf(tool: CatalogTool): Record<string, unknown> {
  const trimmed = trimSchema(tool.inputSchema);
  const schema = trimmed && typeof trimmed === "object" ? (trimmed as Record<string, unknown>) : {};
  return { ...schema, type: "object" };
}

/** mcp_<server>_<tool>, in the characters every provider takes, unique among those already taken. */
export function toolKey(serverId: string, name: string, taken: Set<string>): string {
  const base = `mcp_${serverId.replace(/-/g, "_")}_${name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  let key = base.slice(0, TOOL_NAME_MAX);
  for (let n = 2; taken.has(key); n += 1) key = `${base.slice(0, TOOL_NAME_MAX - String(n).length - 1)}_${n}`;
  taken.add(key);
  return key;
}

type ContentPart = {
  type?: string;
  text?: string;
  mimeType?: string;
  name?: string;
  uri?: string;
  resource?: { uri?: string; text?: string };
};

/** A tool's answer as the model reads it: its text, what else it sent named in brackets, cut to size. */
export function resultText(
  result: { content?: unknown; structuredContent?: unknown; isError?: boolean },
  max = MCP_RESULT_MAX_CHARS
): string {
  const parts = Array.isArray(result.content) ? (result.content as ContentPart[]) : [];
  let text = parts
    .map((part) => {
      switch (part?.type) {
        case "text":
          return part.text ?? "";
        case "image":
        case "audio":
          return `[${part.type} ${part.mimeType ?? ""}]`.replace(" ]", "]");
        case "resource":
          return part.resource?.text ?? `[resource ${part.resource?.uri ?? ""}]`;
        case "resource_link":
          return `[${part.name ?? "link"}] ${part.uri ?? ""}`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!text && result.structuredContent !== undefined) text = JSON.stringify(result.structuredContent);
  if (!text) text = result.isError ? "The tool failed." : "Done, nothing came back.";
  if (result.isError) text = `Error: ${text}`;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** About how many tokens a tool's definition costs in every turn (four characters a token). */
function tokensOf(name: string, description: string, schema: unknown): number {
  return Math.ceil(JSON.stringify({ name, description, input_schema: schema }).length / 4);
}

/** What one server's tools cost in every turn, counted as they go out (descriptions cut short). */
export function toolTokens(tools: readonly CatalogTool[]): number {
  return tools.reduce((sum, item) => sum + tokensOf(item.name, shorten(item.description, DESCRIPTION_MAX_CHARS), inputSchemaOf(item)), 0);
}

function serializableCatalogItem(item: CatalogTool): { item: CatalogTool; text: string } {
  const kept: CatalogTool = { serverId: item.serverId, name: item.name };
  if (item.description !== undefined) kept.description = item.description;
  if (item.inputSchema !== undefined) kept.inputSchema = item.inputSchema;
  const text = JSON.stringify(kept);
  return { item: JSON.parse(text) as CatalogTool, text };
}

/** The part of a listed tool that goes out to the model, so one kept from before reads the same as a fresh one. */
export function catalogItem(item: CatalogTool): CatalogTool {
  return serializableCatalogItem(item).item;
}

function boundedCatalog(id: string, items: readonly CatalogTool[]): CatalogTool[] {
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
  if (sorted.length > MAX_MCP_CATALOG_TOOLS) {
    console.error(`mcp: ${id} listed ${sorted.length} tools; keeping the first ${MAX_MCP_CATALOG_TOOLS} by name`);
  }
  const catalog: CatalogTool[] = [];
  let bytes = 2;
  for (const item of sorted.slice(0, MAX_MCP_CATALOG_TOOLS)) {
    let serialized: { item: CatalogTool; text: string };
    try {
      serialized = serializableCatalogItem(item);
    } catch (error) {
      console.error(`mcp: could not serialize ${id}/${item.name}; leaving it out`, error);
      continue;
    }
    const size = new TextEncoder().encode(serialized.text).byteLength + (catalog.length ? 1 : 0);
    if (bytes + size > MAX_MCP_CATALOG_BYTES) {
      console.error(`mcp: ${id}/${item.name} exceeds the ${MAX_MCP_CATALOG_BYTES}-byte catalog limit; leaving it out`);
      continue;
    }
    catalog.push(serialized.item);
    bytes += size;
  }
  return catalog;
}

/**
 * The tools to offer from the servers that are set up: a ready server's as it lists them now; one that is not ready
 * (still reconnecting after the agent slept, or out of reach for now) as it listed them the last time it was. The
 * list is part of the prompt's cached prefix, so a server that comes back a few seconds late must not take its tools
 * away for one turn and give them back the next: each of those turns would write the whole conversation again.
 * A server that was never ready has nothing kept and offers nothing. Catalogs are sorted and bounded before storage.
 */
export function catalogOf(
  serverIds: readonly string[],
  ready: ReadonlySet<string>,
  live: readonly CatalogTool[],
  kept: ReadonlyMap<string, readonly CatalogTool[]>
): CatalogTool[] {
  return [...serverIds]
    .sort((a, b) => a.localeCompare(b))
    .flatMap((id) => boundedCatalog(id, ready.has(id) ? live.filter((item) => item.serverId === id) : (kept.get(id) ?? [])));
}

/**
 * The connected servers' tools as ours, in a fixed order (by server, then by name) so the list the model gets
 * is the same from one turn to the next and the prompt cache keeps hitting. At most MAX_MCP_TOOLS.
 */
export function mcpToolSet(
  catalog: readonly CatalogTool[],
  call: (serverId: string, name: string, args: unknown) => Promise<string>,
  names: Record<string, string> = {}
): { tools: ToolSet; left: number } {
  const sorted = [...catalog].sort((a, b) => a.serverId.localeCompare(b.serverId) || a.name.localeCompare(b.name));
  const tools: ToolSet = {};
  const taken = new Set<string>();
  for (const item of sorted.slice(0, MAX_MCP_TOOLS)) {
    const from = names[item.serverId] ?? item.serverId;
    const said = shorten(item.description, DESCRIPTION_MAX_CHARS);
    tools[toolKey(item.serverId, item.name, taken)] = tool({
      description: `[${from}] ${said || item.name}`,
      inputSchema: jsonSchema(inputSchemaOf(item) as Parameters<typeof jsonSchema>[0]),
      execute: (args) => call(item.serverId, item.name, args)
    });
  }
  return { tools, left: Math.max(0, sorted.length - MAX_MCP_TOOLS) };
}

/** What connect_mcp_server tells the model. */
export function connectReport(result: { id: string; state: string; authUrl?: string } | { error: string }): string {
  if ("error" in result) return `Not connected: ${result.error}`;
  if (result.authUrl) return `${result.id} needs them to sign in first: give them this link to open, ${result.authUrl} . Its tools come once they have.`;
  return `Connected ${result.id}; its tools are yours from their next message.`;
}

/** Whether a stored server was given a key (the header is in its saved options; the key itself is never read out). */
export function storedWithKey(serverOptions: string | null): boolean {
  try {
    const options = JSON.parse(serverOptions ?? "{}") as { transport?: { requestInit?: { headers?: unknown }; headers?: unknown } };
    const headers = options.transport?.requestInit?.headers ?? options.transport?.headers;
    return Boolean(headers && typeof headers === "object" && Object.keys(headers).length);
  } catch {
    return false;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** The page the OAuth sign-in lands on. The provider's error text is theirs, so it is escaped. */
export function callbackPage(result: { authSuccess: boolean; authError?: string }, name: string | null): Response {
  const title = result.authSuccess ? `${name ?? "MCP"} 接好了` : `${name ?? "MCP"} 没接上`;
  const line = result.authSuccess
    ? "可以关掉这页回去聊天了，下一句开始就能用它的工具。"
    : `授权没成功：${escapeHtml((result.authError ?? "不知道为什么").slice(0, 300))}。回设置页断开再接一次试试。`;
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<body style="font:16px/1.6 system-ui,sans-serif;max-width:32em;margin:15vh auto;padding:0 16px;color:#222;background:#fafafa">
<h1 style="font-size:20px">${escapeHtml(title)}</h1><p>${line}</p><p><a href="/">回住户的网页门</a></p></body>`;
  return new Response(html, { status: result.authSuccess ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
