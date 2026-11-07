// A pretend resident for the tests: just enough of aelios-runner/1 (../PROTOCOL.md), with the same checks the real
// one will make (token per work, receipts replayable, a final is final, no device credential in a summary).
import crypto from "node:crypto";
import http from "node:http";

const STATUSES = ["done", "failed", "needs_you", "cancelled"];

export class FakeCloud {
  constructor() {
    this.works = []; this.claims = new Map(); this.receipts = new Map(); this.accepted = []; this.polls = []; this.beats = 0;
    this.deviceToken = "rr_" + crypto.randomBytes(16).toString("hex");
    this.down = false; this.revoked = false; this.forbidden = false; this.receiptMax = 16 * 1024; this.receiptHits = 0; this.drops = {}; // drops.poll = 1: handle the next poll, then cut the line before answering
    this.seq = 0;
  }
  async listen() {
    this.server = http.createServer((req, res) => this.#handle(req, res));
    await new Promise(resolve => this.server.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${this.server.address().port}`;
    return this;
  }
  close() { this.server.closeAllConnections?.(); return new Promise(resolve => this.server.close(resolve)); }

  /** Put a message in a thread's line. */
  push(fields) {
    const n = ++this.seq;
    const work = { workId: "w_" + String(n).padStart(4, "0"), token: "wt_" + crypto.randomBytes(8).toString("hex"), thread: "t_main", kind: "job", text: "hello", ...fields };
    this.works.push({ work, leased: false });
    return work;
  }
  finals(workId) { return this.accepted.filter(r => r.workId === workId && r.type === "final"); }
  got(workId, type) { return this.accepted.filter(r => r.workId === workId && r.type === type); }
  async until(check, what, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(r => setTimeout(r, 15)); }
    throw new Error("timed out waiting for " + what);
  }

  async #handle(req, res) {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const path = req.url, body = raw ? JSON.parse(raw) : {};
    const send = (status, value) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    const action = path.split("/").pop();
    if (path.endsWith("/web/runner/register")) {
      if (req.headers["x-web-key"] !== "web-key") return send(403, { error: "no", code: "WEB_KEY" });
      return send(200, { runnerId: "run_1", token: this.deviceToken, protocol: "aelios-runner/1" });
    }
    if (this.down) return send(503, { error: "down" });
    if (this.revoked) return send(401, { error: "revoked", code: "UNAUTHORIZED" });
    if (this.forbidden) return send(403, { error: "blocked by a firewall in front" });
    if (req.headers.authorization !== "Bearer " + this.deviceToken) return send(401, { error: "bad token", code: "UNAUTHORIZED" });
    const reply = (status, value) => {
      if (this.drops[action] > 0) { this.drops[action]--; return req.socket.destroy(); } // the cloud did it; the runner never hears
      send(status, value);
    };
    if (action === "heartbeat") { this.beats++; return reply(200, { ok: true, protocol: "aelios-runner/1" }); }
    if (action === "poll") {
      this.polls.push(body);
      const known = this.claims.get(body.claimKey);
      if (known) return reply(200, { work: known });
      const entry = this.works.find(w => !w.leased && body.accept.includes(w.work.kind));
      if (!entry) return reply(200, { work: null });
      entry.leased = true; this.claims.set(body.claimKey, entry.work);
      return reply(200, { work: entry.work });
    }
    if (action === "receipt") {
      this.receiptHits++;
      if (Buffer.byteLength(raw) > this.receiptMax) return reply(413, { error: "too large", code: "BODY_TOO_LARGE" });
      const entry = this.works.find(w => w.work.workId === body.workId);
      if (!entry || entry.work.token !== body.token) return reply(409, { error: "token", code: "INVALID_TOKEN" });
      if (JSON.stringify(body).includes(this.deviceToken)) return reply(400, { error: "credential in receipt", code: "INVALID_RECEIPT" });
      if (!["started", "queued", "final"].includes(body.type) || body.receiptId !== `${body.workId}:${body.type}`) return reply(400, { error: "type", code: "INVALID_RECEIPT" });
      if (body.type === "final") {
        if (!STATUSES.includes(body.status) || typeof body.summary !== "string" || body.summary.length > 4000) return reply(400, { error: "final", code: "INVALID_RECEIPT" });
        if (body.status === "needs_you" && !body.ask?.key) return reply(400, { error: "ask", code: "INVALID_RECEIPT" });
      }
      const fingerprint = JSON.stringify(body);
      const before = this.receipts.get(body.receiptId);
      if (before) return reply(before === fingerprint ? 200 : 409, before === fingerprint ? { ok: true, duplicate: true } : { error: "conflict", code: "RECEIPT_CONFLICT" });
      this.receipts.set(body.receiptId, fingerprint); this.accepted.push(body);
      return reply(200, { ok: true });
    }
    send(404, { error: "not found" });
  }
}
