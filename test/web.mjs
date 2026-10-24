// Unit tests for web_fetch (src/web/fetch.ts), run in Node with every network call faked: redirects are
// checked hop by hop, an empty JavaScript page goes to the browser, pages are cached, long pages are
// shrunk, and a page in GBK is decoded. Usage: node test/web.mjs
// (esbuild comes with wrangler; it bundles the TypeScript for Node.)
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Packages stay outside the bundle and load from node_modules, so the bundle is written next to it.
mkdirSync("node_modules/.cache", { recursive: true });
const dir = mkdtempSync(join("node_modules/.cache", "resident-web-"));
await build({ entryPoints: ["src/web/fetch.ts", "src/web/validate-url.ts"], bundle: true, packages: "external", platform: "node", format: "esm", outdir: dir, logLevel: "error" });
const { webFetchTool } = await import(pathToFileURL(join(process.cwd(), dir, "fetch.js")).href);
const { validateUrlWithDns } = await import(pathToFileURL(join(process.cwd(), dir, "validate-url.js")).href);
rmSync(dir, { recursive: true, force: true });

// --- The fake internet -----------------------------------------------------------------------------

const PUBLIC = "93.184.216.34";
const article = (title, text) => `<html><head><title>${title}</title></head><body><article><p>${text}</p></article></body></html>`;
const LONG = "今天的新闻很长。".repeat(200);
const GBK = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7]); // 你好世界
let requests = [];

const pages = {
  "https://example.com/a": () => new Response(null, { status: 302, headers: { location: "/b" } }),
  "https://example.com/b": () => html(article("第二页", "跳过来了。".repeat(120))),
  "https://example.com/to-local": () => new Response(null, { status: 301, headers: { location: "http://127.0.0.1/admin" } }),
  "https://example.com/to-evil": () => new Response(null, { status: 302, headers: { location: "https://evil.test/" } }),
  "https://example.com/loop": () => new Response(null, { status: 302, headers: { location: "https://example.com/loop" } }),
  "https://example.com/shell": () => html('<html><head><title>壳</title></head><body><div id="app"></div></body></html>'),
  "https://example.com/missing": () => new Response("nope", { status: 404 }),
  "https://example.com/photo": () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
  "https://example.com/long": () => html(article("长文", LONG)),
  "https://example.com/gbk": () => new Response(GBK, { headers: { "content-type": "text/plain; charset=gbk" } }),
  // A site behind Cloudflare Access: with the service token's two headers the page, without them its sign-in.
  "https://gated.example/a/page": (headers) => (hasKey(headers) ? html(article("教材", "第一章的考点。".repeat(80))) : toSignIn()),
  "https://gated.example/a/moved": (headers) => (hasKey(headers) ? new Response(null, { status: 302, headers: { location: "/a/page" } }) : toSignIn()),
  "https://gated.example/a/out": () => new Response(null, { status: 302, headers: { location: "https://example.com/b" } }),
  "https://gated.example/a/shell": (headers) => (hasKey(headers) ? html('<html><head><title>壳</title></head><body><div id="app"></div></body></html>') : toSignIn()),
  "https://gated.example/a/forbidden": () => new Response("no", { status: 403 }),
  "http://gated.example/a/page": () => html(article("明文", "不该带钥匙。".repeat(80)))
};

const KEY = { "CF-Access-Client-Id": "id-1.access", "CF-Access-Client-Secret": "secret-1" };
const KEYS = [{ host: "gated.example", headers: KEY }];
const hasKey = (headers) => headers?.["cf-access-client-id"] === KEY["CF-Access-Client-Id"] && headers?.["cf-access-client-secret"] === KEY["CF-Access-Client-Secret"];
const toSignIn = () => new Response(null, { status: 302, headers: { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/gated.example" } });
const carriedKey = (request) => Object.keys(request.headers ?? {}).some((name) => /^cf-access/i.test(name));

function html(body) {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

let dnsReply = (name, type) => {
  const data = name === "evil.test" ? "10.0.0.7" : PUBLIC;
  return type === "A" ? [{ type: 1, data }] : [];
};

globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
    const name = new URL(url).searchParams.get("name");
    const type = new URL(url).searchParams.get("type");
    return Response.json({ Answer: dnsReply(name, type) });
  }
  // As the site sees them: one value per name, names in lower case.
  const headers = Object.fromEntries(new Headers(init.headers ?? {}));
  requests.push({ url, redirect: init.redirect, headers });
  const page = pages[url];
  if (!page) return new Response("not found", { status: 404 });
  return page(headers);
};

function browser() {
  const calls = [];
  return {
    calls,
    async quickAction(action, options) {
      calls.push({ action, options });
      return Response.json({
        success: true,
        result: article("壳", "脚本跑完以后才有的正文。".repeat(60)),
        meta: { status: 200, title: "壳", finalUrl: options.url }
      });
    }
  };
}

function cache() {
  const pages = new Map();
  return { pages, get: (url) => pages.get(url) ?? null, put: (url, page) => pages.set(url, page) };
}

/** A fake LanguageModel that answers `answer` (or throws it) and records what it was sent. */
function model(answer) {
  const calls = [];
  return {
    calls,
    specificationVersion: "v4",
    provider: "fake",
    modelId: "fake",
    supportedUrls: {},
    async doGenerate(options) {
      const [system, user] = options.prompt;
      calls.push({ system: system.content, user: user.content.map((part) => part.text).join(""), signal: options.abortSignal });
      if (answer instanceof Error) throw answer;
      return {
        content: [{ type: "text", text: answer }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
        warnings: []
      };
    },
    async doStream() {
      throw new Error("compression does not stream");
    }
  };
}

const QWEN = "@cf/qwen/qwen3-30b-a3b-fp8";
const shrinker = (fake, name = QWEN) => ({ name, model: fake });

const read = (reader, input) => webFetchTool(reader).execute(input, { toolCallId: "t", messages: [] });
let failures = 0;
async function step(name, fn) {
  requests = [];
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}\n${error.stack ?? error}`);
  }
}

// --- Tests -----------------------------------------------------------------------------------------

await step("a redirect is followed after its target is checked", async () => {
  const text = await read({ compressor: null }, { url: "https://example.com/a" });
  assert.match(text, /^# 第二页\nhttps:\/\/example\.com\/b\n/);
  assert.ok(text.includes("跳过来了。"));
  assert.deepEqual(requests.map((r) => r.redirect), ["manual", "manual"]);
});

await step("a redirect to a local or private address is refused before it is followed", async () => {
  const local = await read({ compressor: null, browser: browser() }, { url: "https://example.com/to-local" });
  assert.match(local, /^Could not read this page: it redirected somewhere it may not go/);
  const evil = await read({ compressor: null, browser: browser() }, { url: "https://example.com/to-evil" });
  assert.match(evil, /^Could not read this page: it redirected somewhere it may not go/);
  assert.ok(!requests.some((r) => r.url.includes("127.0.0.1") || r.url.includes("evil.test")), JSON.stringify(requests));
});

await step("endless redirects stop", async () => {
  const text = await read({ compressor: null }, { url: "https://example.com/loop" });
  assert.match(text, /redirected more than 5 times/);
  assert.equal(requests.length, 6);
});

await step("a local address is refused outright", async () => {
  const text = await read({ compressor: null }, { url: "http://localhost:8787/web/messages" });
  assert.match(text, /^Cannot read this URL/);
  assert.equal(requests.length, 0);
});

await step("an empty JavaScript page is opened in the browser, without pictures", async () => {
  const b = browser();
  const text = await read({ compressor: null, browser: b }, { url: "https://example.com/shell" });
  assert.ok(text.includes("脚本跑完以后才有的正文。"), text);
  assert.ok(text.includes("(opened in a browser)"));
  assert.equal(b.calls.length, 1);
  assert.equal(b.calls[0].action, "content");
  assert.deepEqual(b.calls[0].options.rejectResourceTypes, ["image", "media", "font"]);
  // Requests to private addresses written in the URL are refused inside the browser too.
  const blocked = (url) => b.calls[0].options.rejectRequestPattern.some((pattern) => new RegExp(pattern).test(url));
  for (const url of ["http://127.0.0.1/", "http://169.254.169.254/latest", "http://10.1.2.3:8080/x", "http://192.168.1.1/", "http://172.20.0.1/", "http://localhost:8787/", "http://[::1]/", "http://user@10.0.0.1/"]) {
    assert.ok(blocked(url), `the browser may not load ${url}`);
  }
  for (const url of ["https://example.com/", "https://172.217.1.1/", "https://news.10.example/", "https://www.localhost-news.com/"]) {
    assert.ok(!blocked(url), `the browser may load ${url}`);
  }
});

await step("without a browser, the empty page comes back as it is", async () => {
  const text = await read({ compressor: null }, { url: "https://example.com/shell" });
  assert.match(text, /^# 壳\n/);
  assert.ok(!text.includes("opened in a browser"));
});

await step("a missing page or a picture is not retried in the browser", async () => {
  const b = browser();
  assert.match(await read({ compressor: null, browser: b }, { url: "https://example.com/missing" }), /HTTP 404/);
  assert.match(await read({ compressor: null, browser: b }, { url: "https://example.com/photo" }), /image\/png, not a text page/);
  assert.equal(b.calls.length, 0);
});

await step("a page read once is kept: another question about it fetches nothing", async () => {
  const c = cache();
  await read({ compressor: null, cache: c }, { url: "https://example.com/b" });
  assert.equal(requests.length, 1);
  const again = await read({ compressor: null, cache: c }, { url: "https://example.com/b", query: "别的" });
  assert.ok(again.includes("跳过来了。"));
  assert.equal(requests.length, 1);
});

await step("with a query, a long page is cut down to what answers it", async () => {
  const fake = model("## 长文\n今天的新闻很长。");
  const text = await read({ compressor: shrinker(fake) }, { url: "https://example.com/long", query: "今天怎么了" });
  assert.ok(text.includes("(only the parts about: 今天怎么了)"), text);
  assert.ok(text.endsWith("## 长文\n今天的新闻很长。"), text);
  assert.equal(fake.calls.length, 1);
  assert.ok(fake.calls[0].system.endsWith("/no_think"), "Qwen3 is told not to think");
  assert.ok(fake.calls[0].user.startsWith("Question: 今天怎么了"));
});

await step("any model the resident can use shrinks pages too, and only Qwen3 gets /no_think", async () => {
  const fake = model("摘到的内容");
  const text = await read({ compressor: shrinker(fake, "anthropic/claude-haiku-5.5") }, { url: "https://example.com/long", query: "新闻" });
  assert.ok(text.endsWith("摘到的内容"), text);
  assert.ok(!fake.calls[0].system.includes("/no_think"));
});

await step("the same question about the same page is answered from the cache", async () => {
  const c = cache();
  const fake = model("摘出来的段落");
  const reader = { compressor: shrinker(fake), cache: c };
  const first = await read(reader, { url: "https://example.com/long", query: "今天怎么了" });
  const again = await read(reader, { url: "https://example.com/long", query: "今天怎么了" });
  assert.equal(again, first);
  assert.equal(fake.calls.length, 1);
  assert.equal(requests.length, 1);
  await read(reader, { url: "https://example.com/long", query: "别的问题" });
  assert.equal(fake.calls.length, 2, "another question asks the model again, without refetching");
  assert.equal(requests.length, 1);
});

await step("a section that answers NOTHING_RELEVANT is dropped, a passage that mentions it is kept", async () => {
  const nothing = await read({ compressor: shrinker(model("NOTHING_RELEVANT.")) }, { url: "https://example.com/long", query: "猫" });
  assert.match(nothing, /Nothing on this page seems to be about: 猫/);
  const kept = await read({ compressor: shrinker(model("The flag NOTHING_RELEVANT is used by the tool.")) }, { url: "https://example.com/long", query: "flag" });
  assert.ok(kept.endsWith("The flag NOTHING_RELEVANT is used by the tool."), kept);
});

await step("a short page with no query is not sent to the model", async () => {
  const fake = model("x");
  await read({ compressor: shrinker(fake) }, { url: "https://example.com/long" });
  assert.equal(fake.calls.length, 0);
});

await step("a think block is dropped from the answer, and the call can be cancelled", async () => {
  const fake = model("<think>想想</think>\n摘到的内容");
  const text = await read({ compressor: shrinker(fake) }, { url: "https://example.com/long", query: "新闻" });
  assert.ok(text.endsWith("摘到的内容"), text);
  assert.ok(fake.calls[0].signal instanceof AbortSignal, "the model call can be cancelled");
});

await step("when the model fails, the page comes back whole", async () => {
  const text = await read({ compressor: shrinker(model(new Error("down"))) }, { url: "https://example.com/long", query: "新闻" });
  assert.ok(text.includes("今天的新闻很长。今天的新闻很长。"));
  assert.ok(text.includes("could not be shortened"));
});

await step("when web_fetch gives up, the model call is stopped and the page comes back whole", async () => {
  const hanging = model("never");
  hanging.doGenerate = (options) => new Promise((_, reject) => {
    hanging.calls.push({ signal: options.abortSignal });
    options.abortSignal.addEventListener("abort", () => reject(new Error("aborted")));
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  const started = Date.now();
  const text = await webFetchTool({ compressor: shrinker(hanging) }).execute(
    { url: "https://example.com/long", query: "新闻" },
    { toolCallId: "t", messages: [], abortSignal: controller.signal }
  );
  assert.ok(Date.now() - started < 3000, "it does not wait for the model's own timeout");
  assert.ok(text.includes("今天的新闻很长。"), text);
  assert.ok(hanging.calls[0].signal.aborted, "the model call was cancelled");
});

await step("a page in GBK is decoded", async () => {
  const text = await read({ compressor: null }, { url: "https://example.com/gbk" });
  assert.ok(text.endsWith("你好世界"), text);
});

await step("a site's key goes with every request to it, and the model is told which sites have one", async () => {
  const text = await read({ compressor: null, keys: KEYS }, { url: "https://gated.example/a/moved" });
  assert.match(text, /^# 教材\nhttps:\/\/gated\.example\/a\/page\n/);
  assert.deepEqual(requests.map((r) => [r.url, carriedKey(r)]), [["https://gated.example/a/moved", true], ["https://gated.example/a/page", true]]);
  assert.match(webFetchTool({ compressor: null, keys: KEYS }).description, /They gave you a key for gated\.example, so the private pages there open too\./);
  assert.doesNotMatch(webFetchTool({ compressor: null }).description, /key/);
  assert.ok(!webFetchTool({ compressor: null, keys: KEYS }).description.includes("secret-1"), "the key itself is never in the prompt");
});

await step("a header in the key takes the place of the one web_fetch would send, whatever its case", async () => {
  requests = [];
  await read({ compressor: null, keys: [{ host: "example.com", headers: { Accept: "application/vnd.github.raw", "User-Agent": "mine" } }] }, { url: "https://example.com/b" });
  assert.equal(requests[0].headers.accept, "application/vnd.github.raw");
  assert.equal(requests[0].headers["user-agent"], "mine");
});

await step("the key never goes to another site, nor over plain http", async () => {
  await read({ compressor: null, keys: KEYS }, { url: "https://gated.example/a/out" });
  assert.deepEqual(requests.map((r) => [r.url, carriedKey(r)]), [["https://gated.example/a/out", true], ["https://example.com/b", false]]);
  requests = [];
  await read({ compressor: null, keys: KEYS }, { url: "https://example.com/b" });
  assert.equal(carriedKey(requests[0]), false);
  requests = [];
  await read({ compressor: null, keys: KEYS }, { url: "http://gated.example/a/page" });
  assert.equal(carriedKey(requests[0]), false);
});

await step("Cloudflare Access's sign-in page is not read: without a key it says one can be added, with a wrong one that it was refused", async () => {
  const without = await read({ compressor: null, browser: browser() }, { url: "https://gated.example/a/page" });
  assert.match(without, /^Could not read this page: gated\.example is behind Cloudflare Access \(a sign-in page\); they can add a key for gated\.example on the settings page$/);
  const wrong = await read({ compressor: null, keys: [{ host: "gated.example", headers: { ...KEY, "CF-Access-Client-Secret": "old" } }] }, { url: "https://gated.example/a/page" });
  assert.match(wrong, /did not let the key in: the key is wrong or has expired, or the Access application has no Service Auth policy for it/);
  assert.ok(!requests.some((r) => r.url.includes("cloudflareaccess.com")), "the sign-in page is never fetched");
});

await step("a keyed page is never opened in the browser, which would not carry the key", async () => {
  const b = browser();
  const thin = await read({ compressor: null, browser: b, keys: KEYS }, { url: "https://gated.example/a/shell" });
  assert.match(thin, /^# 壳/);
  const refused = await read({ compressor: null, browser: b, keys: KEYS }, { url: "https://gated.example/a/forbidden" });
  assert.match(refused, /HTTP 403, which refused the key/);
  const hidden = await read({ compressor: null, browser: b, keys: KEYS }, { url: "https://gated.example/a/missing" });
  assert.match(hidden, /HTTP 404, which with a key can also mean the key may not see it/);
  const plain404 = await read({ compressor: null }, { url: "https://example.com/missing" });
  assert.doesNotMatch(plain404, /key/);
  assert.equal(b.calls.length, 0);
});

await step("DNS validation fails closed on empty answers and CNAME-only answers", async () => {
  const previous = dnsReply;
  try {
    for (const answer of [undefined, [{ type: 5, data: "alias.example" }]]) {
      dnsReply = () => (answer ? [...answer] : []);
      const result = await validateUrlWithDns("https://empty.example/");
      assert.deepEqual(result, { valid: false, error: "Unable to validate URL hostname resolution" });
    }
    dnsReply = (name, type) => type === "A" ? [{ type: 5, data: "alias.example" }, { type: 1, data: PUBLIC }] : [];
    assert.deepEqual(await validateUrlWithDns("https://example.com/"), { valid: true });
  } finally {
    dnsReply = previous;
  }
});

await step("DNS validation accepts only syntactically valid A and AAAA addresses", async () => {
  const previous = dnsReply;
  try {
    for (const [type, code, data] of [["A", 1, "999.1.1.1"], ["AAAA", 28, "not-an-ip"]]) {
      dnsReply = (name, requested) => requested === type ? [{ type: code, data }] : [];
      const result = await validateUrlWithDns("https://invalid.example/");
      assert.equal(result.valid, false, `${type} answer ${data} must not pass`);
    }
    for (const data of ["::1", "0:0:0:0:0:0:0:1"]) {
      dnsReply = (name, type) => type === "AAAA" ? [{ type: 28, data }] : [];
      assert.deepEqual(await validateUrlWithDns("https://loopback.example/"), { valid: false, error: "URL hostname resolves to a private IP address" });
    }
  } finally {
    dnsReply = previous;
  }
});

await step("DNS results are not shared across requests, while the caller map deduplicates one fetch", async () => {
  const previous = dnsReply;
  let calls = 0;
  try {
    dnsReply = (name, type) => {
      calls += 1;
      return type === "A" ? [{ type: 1, data: PUBLIC }] : [];
    };
    assert.equal((await validateUrlWithDns("https://example.com/")).valid, true);
    assert.equal((await validateUrlWithDns("https://example.com/")).valid, true);
    assert.equal(calls, 4, "each independent validation resolves afresh");
    const cache = new Map();
    const results = await Promise.all([validateUrlWithDns("https://example.com/", cache), validateUrlWithDns("https://example.com/", cache)]);
    assert.ok(results.every((result) => result.valid));
    assert.equal(calls, 6, "concurrent hops share only the caller-provided lookup");
    assert.equal(cache.size, 1);
  } finally {
    dnsReply = previous;
  }
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
