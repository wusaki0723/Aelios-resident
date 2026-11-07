// One turn with an ACP helper: start it, open (or reopen) the thread's session, send one prompt, answer permission
// requests by tier, and turn the end of the turn into a receipt outcome. One helper process per turn; the session
// outlives it (session/load or session/resume), so a later turn picks up the same conversation.
import { createHash } from "node:crypto";
import { AcpClosed, AcpConnection, AcpError, PROTOCOL_VERSION } from "./acp.mjs";
import { answer } from "./permission.mjs";

const short = text => createHash("sha1").update(text).digest("hex").slice(0, 12);
/** Added to every prompt. The only way a reply asks the user for a decision; a question mark means nothing. */
export const CONVENTION = "Only if you cannot go on without a decision from the user, end your reply with one last line that starts with `ASK:` followed by the question. Otherwise just finish, and do not end by asking whether to continue.";
const marker = text => {
  const lines = text.trimEnd().split("\n"), last = lines.at(-1).trim();
  if (!last.startsWith("ASK:")) return null;
  return { question: last.slice(4).trim(), body: lines.slice(0, -1).join("\n").trim() };
};

export class Turn {
  /**
   * @param {{launch: object, cwd: string, sessionId?: string, prompt: string, tier: string, timeoutMs?: number,
   *          killAfterMs?: number, redact: (text: string) => string, onSession?: (sessionId: string, how: string) => Promise<void>|void}} o
   */
  constructor(o) {
    Object.assign(this, { timeoutMs: 30 * 60_000, killAfterMs: 10_000 }, Object.fromEntries(Object.entries(o).filter(([, value]) => value !== undefined)));
    this.cancelled = false; this.timedOut = false; this.collecting = false;
    this.current = ""; this.finished = []; this.denied = []; this.opened = null;
  }

  /** Stop this turn. Safe at any moment: before the session exists the turn simply never sends its prompt. */
  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    if (this.conn && this.opened) this.conn.notify("session/cancel", { sessionId: this.opened });
    // A helper that does not answer a cancel is stopped for good, so a stuck turn cannot hold the thread.
    this.killTimer = setTimeout(() => { void this.conn?.close(0); }, this.killAfterMs);
    this.killTimer.unref?.();
  }

  #update(method, params) {
    if (method !== "session/update" || !this.collecting) return; // replayed history while loading is not this turn's
    const update = params.update ?? {};
    if (update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") this.current += String(update.content.text ?? "");
    else if (update.sessionUpdate === "tool_call" && this.current.trim()) { this.finished.push(this.current); this.current = ""; }
  }

  async #request(method, params) {
    if (method !== "session/request_permission") throw new AcpError("method not found", -32601);
    const { response, denied } = answer(this.tier, params, this.cwd);
    if (denied) this.denied.push(denied);
    return response;
  }

  async #open(capabilities) {
    const base = { cwd: this.cwd, mcpServers: [] };
    let how = "new";
    if (this.sessionId) {
      const method = capabilities.loadSession ? "session/load" : capabilities.sessionCapabilities?.resume ? "session/resume" : null;
      how = "fresh-after-lost";
      if (method) {
        try { await this.conn.request(method, { sessionId: this.sessionId, ...base }, 60_000); this.opened = this.sessionId; return method === "session/load" ? "loaded" : "resumed"; }
        catch (error) { if (!(error instanceof AcpError)) throw error; /* the helper says it has no such session */ }
      }
    }
    const created = await this.conn.request("session/new", base, 60_000);
    if (typeof created.sessionId !== "string" || !created.sessionId) throw new AcpError("helper gave no session id", -32603);
    this.opened = created.sessionId;
    return how;
  }

  /** @returns {Promise<{status: string, summary: string, sessionId: string|null, how: string, ask?: object}>} */
  async run() {
    this.conn = new AcpConnection(this.launch, { onNotification: (m, p) => this.#update(m, p), onRequest: (m, p) => this.#request(m, p) }).start();
    let how = "new";
    const stderrNote = () => this.redact(this.conn.stderr.trim().split("\n").slice(-3).join(" ")).slice(0, 300);
    try {
      const init = await this.conn.request("initialize", { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {}, clientInfo: { name: "aelios-runner", version: "0.1.0" } }, 30_000);
      how = await this.#open(init.agentCapabilities ?? {});
      await this.onSession?.(this.opened, how);
      if (this.cancelled) return this.#cancelled(how);
      this.timer = setTimeout(() => { this.timedOut = true; this.cancel(); }, this.timeoutMs);
      this.timer.unref?.();
      this.collecting = true;
      const result = await this.conn.request("session/prompt", { sessionId: this.opened, prompt: [{ type: "text", text: `${this.prompt}\n\n${CONVENTION}` }] });
      return this.#outcome(String(result.stopReason ?? "end_turn"), how);
    } catch (error) {
      if (this.cancelled && !this.timedOut) return this.#cancelled(how);
      if (this.timedOut) return this.#stuck(how, "帮手超过时限没有做完，已叫停。");
      if (error instanceof AcpClosed) {
        if (!this.opened) return { status: "failed", summary: this.redact(`帮手没能启动或没有连上：${error.message} ${stderrNote()}`), sessionId: null, how };
        return this.#stuck(how, `帮手进程中途断了（${this.redact(error.message)}）。不会自动重做。 ${stderrNote()}`.trim());
      }
      return { status: "failed", summary: this.redact(`帮手报错：${error.message}`), sessionId: this.opened, how };
    } finally {
      clearTimeout(this.timer); clearTimeout(this.killTimer);
      await this.conn.close();
    }
  }

  #text() { return (this.current.trim() || this.finished.at(-1)?.trim() || ""); }

  #cancelled(how) {
    const last = this.#text();
    return { status: "cancelled", summary: this.redact(last ? `已停止。停下前最后一段：${last}` : "已停止。"), sessionId: this.opened, how };
  }

  #stuck(how, why) {
    const key = "stuck:" + short(why + (this.opened ?? ""));
    return { status: "needs_you", summary: this.redact(why), sessionId: this.opened, how, ask: { key, question: this.redact(why + " 要不要接着做？") } };
  }

  #outcome(stopReason, how) {
    const final = this.#text(), base = { sessionId: this.opened, how };
    if (this.timedOut) return this.#stuck(how, "帮手超过时限没有做完，已叫停。");
    if (stopReason === "cancelled") return this.#cancelled(how);
    if (stopReason === "refusal" || stopReason === "max_tokens" || stopReason === "max_turn_requests") {
      const why = `帮手中途停下了（${stopReason}）。${final ? "最后一段：" + final : ""}`;
      return { ...base, status: "needs_you", summary: this.redact(why), ask: { key: "stop:" + short(stopReason + final), question: this.redact(why) } };
    }
    if (this.denied.length) {
      const list = this.denied.map(item => "· " + item).join("\n");
      const summary = this.redact(`${final || "（帮手没有留下文字）"}\n\n有操作被这台机器的权限档位（${this.tier}）拒绝了：\n${list}`);
      return { ...base, status: "needs_you", summary, ask: { key: "perm:" + short(list), question: this.redact(`帮手想做下面这些，但这台机器的档位是 ${this.tier}，已拒绝：\n${list}`) } };
    }
    if (!final) return { ...base, status: "needs_you", summary: "这一轮结束了，但帮手没有留下文字结果。", ask: { key: "silent:" + short(String(this.opened) + Date.now()), question: "这一轮结束了，但帮手没有留下文字结果，要不要再问一次？" } };
    const asked = marker(final);
    if (asked) {
      const question = this.redact(asked.question || "（帮手要你拍板，但没写问题）");
      return { ...base, status: "needs_you", summary: this.redact(asked.body || question), ask: { key: "q:" + short(final), question } };
    }
    return { ...base, status: "done", summary: this.redact(final) };
  }
}
