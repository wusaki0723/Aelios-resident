// Unit tests for turning other people's MCP servers into the resident's tools (src/mcp-servers.ts). Usage: node test/mcp-servers.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

mkdirSync("node_modules/.cache", { recursive: true });
const dir = mkdtempSync(join("node_modules/.cache", "resident-mcp-"));
const out = join(dir, "mcp-servers.mjs");
await build({ entryPoints: ["src/mcp-servers.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error", external: ["ai"] });
const m = await import(pathToFileURL(join(process.cwd(), out)).href);
rmSync(dir, { recursive: true, force: true });

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.log(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

await test("only https addresses, or http on this machine, and never with a password in them", () => {
  assert.equal(m.checkServerUrl(" https://mcp.notion.com/mcp#x ").url, "https://mcp.notion.com/mcp");
  assert.equal(m.checkServerUrl("http://127.0.0.1:9999/ext/mcp").url, "http://127.0.0.1:9999/ext/mcp");
  assert.ok(m.checkServerUrl("http://example.com/mcp").error);
  assert.ok(m.checkServerUrl("ftp://example.com").error);
  assert.ok(m.checkServerUrl("https://me:pw@example.com/mcp").error);
  assert.ok(m.checkServerUrl("notion").error);
});

await test("addresses in an error keep only their origin", () => {
  assert.equal(m.hideUrls("Failed to connect to MCP server at https://x.example/s/SECRET/mcp?api_key=K: 500"), "Failed to connect to MCP server at https://x.example/…: 500");
  assert.equal(m.hideUrls("(http://127.0.0.1:9999/a?k=1) and https://b.example"), "(http://127.0.0.1:9999/…) and https://b.example/…");
  assert.equal(m.hideUrls("no address"), "no address");
});

await test("ids come from the name, else from the address", () => {
  assert.equal(m.serverIdFor("Notion", "https://mcp.notion.com/mcp"), "notion");
  assert.equal(m.serverIdFor("我的笔记", "https://mcp.notion.com/mcp"), "notion");
  assert.equal(m.serverIdFor(undefined, "https://api.github.com/mcp"), "github");
  assert.equal(m.serverIdFor("", "http://127.0.0.1:9999/ext/mcp"), "local");
  assert.equal(m.serverIdFor("A very long name for a server indeed", "https://x.com"), "a-very-long-name-for-a-s");
});

await test("a key goes out as a bearer token unless it names its header", () => {
  assert.equal(m.keyHeaders(""), undefined);
  assert.deepEqual(m.keyHeaders("abc"), { Authorization: "Bearer abc" });
  assert.deepEqual(m.keyHeaders("Bearer abc"), { Authorization: "Bearer abc" });
  assert.deepEqual(m.keyHeaders("x-api-key: k1"), { "x-api-key": "k1" });
  assert.deepEqual(m.keyHeaders("Authorization: Token t"), { Authorization: "Token t" });
});

await test("descriptions keep their first paragraph, cut at a sentence end", () => {
  assert.equal(m.shorten("One line.\n\nMore detail."), "One line.");
  const long = `${"Searches pages. ".repeat(30)}`;
  const cut = m.shorten(long, 100);
  assert.ok(cut.length <= 100 && cut.endsWith("."), cut);
  assert.ok(m.shorten("x".repeat(200), 50).endsWith("…"));
});

await test("schemas lose their long descriptions and keywords, never a parameter called title", () => {
  const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Input",
    type: "object",
    properties: {
      title: { type: "string", description: `${"The page title. ".repeat(20)}`, examples: ["a"] },
      tags: { type: "array", items: { type: "string", title: "Tag", description: "x".repeat(300) } },
      mode: { anyOf: [{ const: "a" }, { const: "b", description: "y".repeat(300) }] }
    },
    required: ["title"]
  };
  const trimmed = m.trimSchema(schema);
  assert.equal(trimmed.$schema, undefined);
  assert.equal(trimmed.title, undefined);
  assert.ok(trimmed.properties.title, "the title parameter survives");
  assert.equal(trimmed.properties.title.type, "string");
  assert.equal(trimmed.properties.title.examples, undefined);
  assert.ok(trimmed.properties.title.description.length <= 120);
  assert.equal(trimmed.properties.tags.items.title, undefined);
  assert.ok(trimmed.properties.tags.items.description.length <= 121);
  assert.ok(trimmed.properties.mode.anyOf[1].description.length <= 121);
  assert.deepEqual(trimmed.required, ["title"]);
});

await test("tool names say which server they come from and never collide", () => {
  const taken = new Set();
  assert.equal(m.toolKey("my-notes", "search pages", taken), "mcp_my_notes_search_pages");
  assert.equal(m.toolKey("my-notes", "search.pages", taken), "mcp_my_notes_search_pages_2");
  const long = m.toolKey("server", "x".repeat(100), taken);
  assert.ok(long.length <= 64);
  const again = m.toolKey("server", "x".repeat(100), taken);
  assert.ok(again.length <= 64 && again !== long);
});

await test("results read as text, what else came back named, errors marked, cut to size", () => {
  assert.equal(m.resultText({ content: [{ type: "text", text: "hi" }, { type: "image", mimeType: "image/png" }] }), "hi\n[image image/png]");
  assert.equal(m.resultText({ content: [{ type: "resource_link", name: "doc", uri: "https://a" }] }), "[doc] https://a");
  assert.equal(m.resultText({ content: [{ type: "resource", resource: { uri: "u", text: "body" } }] }), "body");
  assert.equal(m.resultText({ content: [], structuredContent: { a: 1 } }), '{"a":1}');
  assert.equal(m.resultText({ content: [{ type: "text", text: "nope" }], isError: true }), "Error: nope");
  assert.equal(m.resultText({ content: [] }), "Done, nothing came back.");
  assert.equal(m.resultText({ content: [{ type: "text", text: "z".repeat(50) }] }, 10), `${"z".repeat(10)}…`);
});

await test("the tool set is in a fixed order, capped, and every description says its server", async () => {
  const catalog = [];
  for (let i = 0; i < 45; i += 1) catalog.push({ serverId: i % 2 ? "b" : "a", name: `t${String(i).padStart(2, "0")}`, description: "Does a thing.", inputSchema: { type: "object", properties: {} } });
  const calls = [];
  const { tools, left } = m.mcpToolSet(catalog, async (server, name, args) => (calls.push([server, name, args]), "ok"), { a: "Alpha" });
  const keys = Object.keys(tools);
  assert.equal(keys.length, m.MAX_MCP_TOOLS);
  assert.equal(left, 5);
  assert.ok(keys[0].startsWith("mcp_a_"));
  assert.deepEqual(keys, [...keys].sort((x, y) => (x.split("_")[1] + x).localeCompare(y.split("_")[1] + y)));
  assert.equal(tools[keys[0]].description, "[Alpha] Does a thing.");
  assert.equal(await tools[keys[0]].execute({ q: 1 }, {}), "ok");
  assert.deepEqual(calls[0], ["a", "t00", { q: 1 }]);
  // The same catalog in another order gives the same list.
  const shuffled = m.mcpToolSet([...catalog].reverse(), async () => "ok", { a: "Alpha" });
  assert.deepEqual(Object.keys(shuffled.tools), keys);
});

await test("catalogs are sorted and bounded by tool count before they are cached", () => {
  const live = [];
  for (let i = m.MAX_MCP_CATALOG_TOOLS; i >= 0; i -= 1) {
    live.push({ serverId: "notes", name: `t${String(i).padStart(3, "0")}`, inputSchema: { type: "object" } });
  }
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  let catalog;
  try {
    catalog = m.catalogOf(["notes"], new Set(["notes"]), live, new Map());
  } finally {
    console.error = original;
  }
  assert.equal(catalog.length, m.MAX_MCP_CATALOG_TOOLS);
  assert.deepEqual(catalog.map((tool) => tool.name), catalog.map((tool) => tool.name).sort((a, b) => a.localeCompare(b)));
  assert.ok(!catalog.some((tool) => tool.name === `t${m.MAX_MCP_CATALOG_TOOLS}`));
  assert.ok(errors.some((line) => line.includes("notes") && line.includes(String(m.MAX_MCP_CATALOG_TOOLS + 1))));
});

await test("catalogs reject oversized or unserializable schemas without exceeding the storage byte cap", () => {
  const live = [
    { serverId: "notes", name: "a-huge", inputSchema: { type: "object", description: "x".repeat(m.MAX_MCP_CATALOG_BYTES) } },
    { serverId: "notes", name: "b-circular", inputSchema: null },
    { serverId: "notes", name: "c-good", inputSchema: { type: "object", properties: { q: { type: "string" } } } }
  ];
  live[1].inputSchema = live[1];
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.map(String).join(" "));
  let catalog;
  try {
    catalog = m.catalogOf(["notes"], new Set(["notes"]), live, new Map());
  } finally {
    console.error = original;
  }
  assert.deepEqual(catalog.map((tool) => tool.name), ["c-good"]);
  assert.ok(new TextEncoder().encode(JSON.stringify(catalog)).byteLength <= m.MAX_MCP_CATALOG_BYTES);
  assert.ok(errors.some((line) => line.includes("notes/a-huge") && line.includes("byte")));
  assert.ok(errors.some((line) => line.includes("notes/b-circular") && line.includes("serialize")));
});

await test("a server that is not ready yet offers the tools it listed last time, so the tools stay the same", () => {
  const live = [
    { serverId: "notes", name: "search", description: "Search notes", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
    { serverId: "calendar", name: "today", description: "Today's events" }
  ];
  const ready = new Set(["notes", "calendar"]);
  const first = m.catalogOf(["calendar", "notes"], ready, live, new Map());
  // Only what goes out to the model, and the same after a trip through storage.
  assert.deepEqual(first.find((t) => t.name === "search"), { serverId: "notes", name: "search", description: "Search notes", inputSchema: { type: "object", properties: {} } });
  const kept = new Map([["notes", JSON.parse(JSON.stringify(first.filter((t) => t.serverId === "notes")))]]);
  // After a sleep: notes has not reconnected yet, and its live list is empty.
  const asleep = m.catalogOf(["calendar", "notes"], new Set(["calendar"]), live.filter((t) => t.serverId === "calendar"), kept);
  assert.deepEqual(asleep, first);
  const call = async () => "";
  const describe = (set) => JSON.stringify(Object.entries(set.tools).map(([key, t]) => [key, t.description, t.inputSchema.jsonSchema]));
  assert.equal(describe(m.mcpToolSet(asleep, call)), describe(m.mcpToolSet(first, call)));
  // A server never ready offers nothing; one no longer set up is not asked about.
  assert.deepEqual(m.catalogOf(["other"], new Set(), [], kept), []);
  assert.deepEqual(m.catalogOf(["calendar"], ready, live, kept).map((t) => t.name), ["today"]);
});

await test("a tool's cost is counted with its description already cut", () => {
  const short = m.toolTokens([{ serverId: "a", name: "t", description: "Short." }]);
  const long = m.toolTokens([{ serverId: "a", name: "t", description: "Short.\n\n" + "x".repeat(5000) }]);
  assert.equal(short, long);
  assert.ok(short > 0);
});

await test("what connecting tells the model", () => {
  assert.match(m.connectReport({ error: "坏了" }), /^Not connected: 坏了/);
  assert.match(m.connectReport({ id: "notion", state: "authenticating", authUrl: "https://a/b" }), /https:\/\/a\/b/);
  assert.match(m.connectReport({ id: "notion", state: "ready" }), /^Connected notion/);
});

await test("a stored server says whether it has a key, never what it is", () => {
  assert.equal(m.storedWithKey(JSON.stringify({ transport: { requestInit: { headers: { Authorization: "Bearer k" } } } })), true);
  assert.equal(m.storedWithKey(JSON.stringify({ transport: { headers: { "x-api-key": "k" } } })), true);
  assert.equal(m.storedWithKey(JSON.stringify({ transport: {} })), false);
  assert.equal(m.storedWithKey(null), false);
  assert.equal(m.storedWithKey("not json"), false);
});

await test("the sign-in page escapes what the provider said", async () => {
  const good = m.callbackPage({ authSuccess: true }, "Notion");
  assert.equal(good.status, 200);
  assert.match(await good.text(), /Notion 接好了/);
  const bad = m.callbackPage({ authSuccess: false, authError: "<script>alert(1)</script>" }, "<b>x</b>");
  assert.equal(bad.status, 400);
  const html = await bad.text();
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<b>x</b>"));
  assert.match(html, /&lt;script&gt;/);
});
