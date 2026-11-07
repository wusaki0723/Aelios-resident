// A small ACP (Agent Client Protocol) client over stdio: newline-delimited JSON-RPC 2.0 with a child process.
// The client declares no file or terminal capability, so the helper does its own work in its own sandbox.
import { spawn } from "node:child_process";

export const PROTOCOL_VERSION = 1;

export class AcpError extends Error {
  constructor(message, code, data) { super(message); this.name = "AcpError"; this.code = code; this.data = data; }
}
/** The helper process went away (or never started) before it answered. Never an answer from the helper itself. */
export class AcpClosed extends Error { constructor(message) { super(message); this.name = "AcpClosed"; } }

export class AcpConnection {
  /**
   * @param {{command: string, args?: string[], env?: Record<string,string>, cwd: string}} launch
   * @param {{onNotification?: (method: string, params: any) => void, onRequest?: (method: string, params: any) => Promise<any>}} handlers
   */
  constructor(launch, handlers = {}) {
    this.launch = launch; this.handlers = handlers;
    this.nextId = 1; this.pending = new Map(); this.buffer = ""; this.closed = false; this.stderr = "";
    this.exited = new Promise(resolve => { this.#resolveExit = resolve; });
  }
  #resolveExit;

  start() {
    // detached: its own process group, so closing it also stops whatever the helper started.
    const child = this.child = spawn(this.launch.command, this.launch.args ?? [], {
      cwd: this.launch.cwd, env: { ...process.env, ...this.launch.env }, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32"
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => this.#read(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { this.stderr = (this.stderr + chunk).slice(-4000); });
    child.stdin.on("error", () => {});
    child.on("error", error => this.#end(new AcpClosed(`helper did not start: ${error.code ?? error.message}`)));
    child.on("close", (code, signal) => this.#end(new AcpClosed(`helper exited (${signal ?? code})`)));
    return this;
  }

  #end(error) {
    if (this.closed) return;
    this.closed = true;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
    this.#resolveExit();
  }

  #read(chunk) {
    this.buffer += chunk;
    let at;
    while ((at = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, at).trim(); this.buffer = this.buffer.slice(at + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; } // helpers may print stray non-JSON lines
      if (!message || typeof message !== "object") continue;
      void this.#dispatch(message);
    }
  }

  async #dispatch(message) {
    if (message.method === undefined) { // a response to one of ours
      const wait = this.pending.get(message.id);
      if (!wait) return;
      this.pending.delete(message.id);
      if (message.error) wait.reject(new AcpError(String(message.error.message ?? "ACP error"), message.error.code, message.error.data));
      else wait.resolve(message.result ?? {});
      return;
    }
    if (message.id === undefined) { // a notification
      try { this.handlers.onNotification?.(message.method, message.params ?? {}); } catch { /* a bad update never stops the turn */ }
      return;
    }
    try { // a request from the helper to us
      if (!this.handlers.onRequest) throw new AcpError("method not found", -32601);
      this.#send({ jsonrpc: "2.0", id: message.id, result: await this.handlers.onRequest(message.method, message.params ?? {}) });
    } catch (error) {
      const code = error instanceof AcpError ? error.code : -32603;
      this.#send({ jsonrpc: "2.0", id: message.id, error: { code, message: error instanceof AcpError ? error.message : "internal error" } });
    }
  }

  #send(message) {
    if (this.closed || !this.child.stdin.writable) return false;
    this.child.stdin.write(JSON.stringify(message) + "\n");
    return true;
  }

  request(method, params, timeoutMs = 0) {
    if (this.closed) return Promise.reject(new AcpClosed("helper is not running"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let timer;
      const settle = fn => value => { clearTimeout(timer); fn(value); };
      this.pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      if (timeoutMs > 0) timer = setTimeout(() => { this.pending.delete(id); reject(new AcpError(`${method} timed out`, -32000)); }, timeoutMs);
      this.#send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method, params) { return this.#send({ jsonrpc: "2.0", method, params }); }

  /** Ask politely first (stdin closes), then stop the whole process group. */
  async close(graceMs = 3000) {
    if (!this.child) return;
    try { this.child.stdin.end(); } catch { /* already closed */ }
    const stop = signal => { try { process.platform === "win32" ? this.child.kill(signal) : process.kill(-this.child.pid, signal); } catch { /* gone */ } };
    const gone = await Promise.race([this.exited.then(() => true), new Promise(r => setTimeout(() => r(false), graceMs))]);
    if (!gone) { stop("SIGTERM"); await Promise.race([this.exited, new Promise(r => setTimeout(r, graceMs))]); }
    if (!this.closed) { stop("SIGKILL"); await Promise.race([this.exited, new Promise(r => setTimeout(r, graceMs))]); }
    else stop("SIGKILL"); // children the helper left behind in its group
  }
}
