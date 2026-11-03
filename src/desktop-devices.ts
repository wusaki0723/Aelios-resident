// Resident-scoped, opt-in native DSH execution. No paths, filesystem grants or web keys live here.
import type { Sql } from "./sticker-store";
import type { Task, TaskStore } from "./cloud-tasks";

export const DESKTOP_PROTOCOL = "resident-dsh/1";
export const DESKTOP_MAX_BYTES = 16 * 1024;
export const DESKTOP_ONLINE_MS = 90_000;
const LEASE_MS = 5 * 60_000;
const QUEUE_TTL_MS = 24 * 60 * 60_000;
const MAX_PENDING = 16;
const identifier = /^[A-Za-z0-9_.:-]{1,160}$/;
const taskId = /^t_[0-9a-f]{10}$/;
const terminal = new Set(["completed", "failed", "needs_you", "revoked", "expired"]);
type Device = { id: string; token_hash: string; label: string; created_at: number; last_seen_at: number | null; revoked_at: number | null };
type Job = { job_id: string; device_id: string; lease_id: string; attempt: number; state: string; lease_until: number | null; created_at: number; terminal_event: string };
type Event = { eventId: string; jobId: string; leaseId: string; type: "started" | "completed" | "failed" | "needs_you"; summary: string; sessionId: string };
export class DesktopError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
function fail(status: number, code: string, message: string): never { throw new DesktopError(status, code, message); }
function random(prefix: string, bytes: number): string {
  return prefix + [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function hash(token: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map(b => b.toString(16).padStart(2, "0")).join("");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "INVALID_BODY", "请求必须是 JSON 对象");
  return value as Record<string, unknown>;
}
function eventOf(input: unknown): Event {
  const body = object(input);
  const allowed = ["eventId", "jobId", "leaseId", "type", "summary", "sessionId"];
  if (Object.keys(body).some(key => !allowed.includes(key))) fail(400, "INVALID_EVENT", "事件含有未知字段");
  const { eventId, jobId, leaseId, type } = body;
  if (typeof eventId !== "string" || !identifier.test(eventId) || typeof jobId !== "string" || !taskId.test(jobId) ||
      typeof leaseId !== "string" || !/^lease_[0-9a-f]{32}$/.test(leaseId) ||
      !["started", "completed", "failed", "needs_you"].includes(String(type))) fail(400, "INVALID_EVENT", "事件标识或类型无效");
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const sessionId = body.sessionId === undefined ? "" : body.sessionId;
  if ((body.summary !== undefined && typeof body.summary !== "string") || summary.length > 4000 || (type !== "started" && !summary) || typeof sessionId !== "string" || (sessionId && !identifier.test(sessionId))) {
    fail(400, "INVALID_EVENT", "摘要最多 4000 字，结果不能为空；会话标识必须是不透明标识");
  }
  return { eventId, jobId, leaseId, type: type as Event["type"], summary, sessionId };
}

/** Read a bounded JSON body without trusting Content-Length or buffering an unlimited stream. */
export async function readDesktopJson(request: Request): Promise<unknown> {
  if ((request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") fail(415, "JSON_REQUIRED", "请发送 JSON 请求");
  if (Number(request.headers.get("content-length") ?? 0) > DESKTOP_MAX_BYTES) fail(413, "BODY_TOO_LARGE", "请求过大");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "INVALID_BODY", "请求必须包含 JSON 对象");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > DESKTOP_MAX_BYTES) { await reader.cancel(); fail(413, "BODY_TOO_LARGE", "请求过大"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, "INVALID_JSON", "JSON 格式无效"); }
  return object(value);
}

/** Errors are converted before crossing RPC; neither token nor submitted payload is included in an error. */
export async function desktopReply(operation: () => unknown | Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try { return { status: 200, body: await operation() }; }
  catch (error) {
    if (error instanceof DesktopError) return { status: error.status, body: { error: error.message, code: error.code } };
    throw error;
  }
}

export class DesktopDeviceStore {
  constructor(private readonly sql: Sql, private readonly tasks: TaskStore, private readonly atomic: <T>(operation: () => T) => T) {
    sql`CREATE TABLE IF NOT EXISTS res_desktop_devices (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER)`;
    sql`CREATE UNIQUE INDEX IF NOT EXISTS res_desktop_one_active ON res_desktop_devices ((1)) WHERE revoked_at IS NULL`;
    sql`CREATE TABLE IF NOT EXISTS res_desktop_jobs (job_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, lease_id TEXT NOT NULL,
      attempt INTEGER NOT NULL, state TEXT NOT NULL, lease_until INTEGER, created_at INTEGER NOT NULL, terminal_event TEXT NOT NULL)`;
    sql`CREATE TABLE IF NOT EXISTS res_desktop_events (event_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, fingerprint TEXT NOT NULL)`;
    sql`CREATE TABLE IF NOT EXISTS res_desktop_reports (job_id TEXT PRIMARY KEY, delivered INTEGER NOT NULL DEFAULT 0)`;
  }

  active(): Device | null {
    return this.sql<Device>`SELECT * FROM res_desktop_devices WHERE revoked_at IS NULL LIMIT 1`[0] ?? null;
  }

  list() {
    this.atomic(() => { const device = this.active(); if (device) this.expire(device.id); });
    return { protocol: DESKTOP_PROTOCOL, devices: this.sql<Device>`SELECT * FROM res_desktop_devices ORDER BY created_at DESC LIMIT 20`.map(device => ({
      deviceId: device.id, label: device.label, lastSeenAt: device.last_seen_at, revokedAt: device.revoked_at,
      online: device.revoked_at === null && device.last_seen_at !== null && Date.now() - device.last_seen_at < DESKTOP_ONLINE_MS
    })) };
  }

  async register(input: unknown) {
    const body = object(input);
    if (Object.keys(body).some(key => key !== "label") || typeof body.label !== "string" || !body.label.trim() || body.label.trim().length > 60) {
      fail(400, "INVALID_DEVICE", "设备名称为 1 到 60 字，不传本机路径或环境信息");
    }
    const label = body.label.trim();
    const token = random("rd_", 32), tokenHash = await hash(token), deviceId = random("dev_", 12);
    return this.atomic(() => {
      if (this.active()) fail(409, "DEVICE_EXISTS", "这个住户已绑定一台设备；请先撤销原设备");
      this.sql`INSERT INTO res_desktop_devices VALUES (${deviceId}, ${tokenHash}, ${label}, ${Date.now()}, ${null}, ${null})`;
      return { deviceId, token, protocol: DESKTOP_PROTOCOL };
    });
  }

  revoke(input: unknown) {
    const body = object(input), device = this.active();
    if (typeof body.deviceId !== "string" || !device || device.id !== body.deviceId) fail(404, "UNKNOWN_DEVICE", "没有这台已授权设备");
    return this.atomic(() => {
      this.sql`UPDATE res_desktop_devices SET revoked_at = ${Date.now()} WHERE id = ${device.id}`;
      for (const job of this.sql<Job>`SELECT * FROM res_desktop_jobs WHERE device_id = ${device.id}`) {
        if (terminal.has(job.state)) continue;
        this.finish(job, "revoked", "设备授权已撤销；任务没有重新派发，请在原设备确认执行状态。");
      }
      return { ok: true };
    });
  }

  /** A thread cannot silently move to a newly paired computer, even if its previous device was revoked. */
  enqueue(task: Task, follows: Task | null) {
    return this.atomic(() => {
      const device = this.active();
      if (!device) fail(409, "NO_DEVICE", "还没有配对本机设备；本机任务不会改派到云端");
      if (follows?.runs === "desktop" && follows.deviceId !== device.id) fail(409, "DEVICE_CHANGED", "原线程的设备已更换；请明确新建任务，不会把旧线程交给另一台电脑");
      if (follows?.runs === "desktop") {
        const previous = this.job(follows.id);
        if (!previous || !["completed", "failed", "needs_you"].includes(previous.state)) fail(409, "THREAD_BUSY", "原任务的执行结果尚未确认，请先在原设备核实");
      }
      const count = this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM res_desktop_jobs WHERE state IN ('queued', 'claimed', 'running', 'unknown')`[0]?.n ?? 0;
      if (count >= MAX_PENDING) fail(429, "QUEUE_FULL", "本机待确认任务已满，请先处理原有任务");
      this.sql`INSERT INTO res_desktop_jobs VALUES (${task.id}, ${device.id}, ${""}, ${0}, ${"queued"}, ${null}, ${Date.now()}, ${""})`;
      this.sql`UPDATE res_tasks SET desktop_device_id = ${device.id}, progress = ${"等待已授权设备领取"} WHERE id = ${task.id}`;
      return this.tasks.get(task.id)!;
    });
  }

  private job(id: string): Job | null { return this.sql<Job>`SELECT * FROM res_desktop_jobs WHERE job_id = ${id}`[0] ?? null; }

  private async authenticate(token: string): Promise<string> {
    if (!/^rd_[0-9a-f]{64}$/.test(token)) fail(401, "UNAUTHORIZED", "设备认证失效");
    const fingerprint = await hash(token);
    return fingerprint;
  }

  private authorized(fingerprint: string): Device {
    const device = this.active();
    if (!device || device.token_hash !== fingerprint) fail(401, "UNAUTHORIZED", "设备认证失效");
    return device;
  }

  async request(token: string, action: "heartbeat" | "claim" | "events", input: unknown, claimEnabled = true) {
    const fingerprint = await this.authenticate(token);
    return this.atomic(() => {
      const device = this.authorized(fingerprint);
      if (action === "claim" && !claimEnabled) fail(409, "TASKS_DISABLED", "后台帮忙关着，不能领取新任务");
      this.expire(device.id);
      if (action === "events") {
        const event = eventOf(input);
        if (event.summary.includes(token) || event.sessionId.includes(token) || event.eventId.includes(token)) fail(400, "INVALID_EVENT", "事件不能包含设备凭据");
        return this.event(device, event);
      }
      const body = object(input);
      if (Object.keys(body).length) fail(400, "INVALID_BODY", "心跳和领取不接受任务、路径或命令参数");
      this.sql`UPDATE res_desktop_devices SET last_seen_at = ${Date.now()} WHERE id = ${device.id}`;
      if (action === "heartbeat") {
        this.sql`UPDATE res_desktop_jobs SET lease_until = ${Date.now() + LEASE_MS} WHERE device_id = ${device.id} AND state IN ('claimed', 'running')`;
        return { ok: true, protocol: DESKTOP_PROTOCOL };
      }
      if (this.sql<Job>`SELECT * FROM res_desktop_jobs WHERE device_id = ${device.id} AND state IN ('claimed', 'running', 'unknown') LIMIT 1`.length) return { job: null };
      const job = this.sql<Job>`SELECT * FROM res_desktop_jobs WHERE device_id = ${device.id} AND state = 'queued' ORDER BY created_at, rowid LIMIT 1`[0];
      if (!job) return { job: null };
      const task = this.tasks.get(job.job_id);
      if (!task || task.runs !== "desktop") fail(409, "UNKNOWN_JOB", "任务已不可领取");
      const leaseId = random("lease_", 16), attempt = job.attempt + 1;
      this.sql`UPDATE res_desktop_jobs SET lease_id = ${leaseId}, attempt = ${attempt}, state = ${"claimed"}, lease_until = ${Date.now() + LEASE_MS} WHERE job_id = ${job.job_id}`;
      this.tasks.progress(task.id, "本机已领取，等待本机授权执行");
      // The prior native session is only a hint; the Host validates its own mapping before reuse.
      const previous = task.follows ? this.tasks.get(task.follows) : null;
      return { job: { id: task.id, thread: task.root, title: task.title, instruction: task.job, leaseId, attempt, protocol: DESKTOP_PROTOCOL,
        ...(previous?.deviceId === device.id && previous.desktopSessionId ? { sessionId: previous.desktopSessionId } : {}) } };
    });
  }

  /** Claimed jobs never return to the queue. A matching late result may reconcile an uncertain claim. */
  private expire(deviceId: string) {
    const now = Date.now();
    for (const job of this.sql<Job>`SELECT * FROM res_desktop_jobs WHERE device_id = ${deviceId} AND state IN ('queued', 'claimed', 'running')`) {
      if (job.state === "queued" && now - job.created_at > QUEUE_TTL_MS) this.finish(job, "expired", "本机任务超过领取期限，未执行；请重新确认是否需要新建任务。");
      else if (job.state !== "queued" && job.lease_until !== null && job.lease_until < now) {
        this.sql`UPDATE res_desktop_jobs SET state = ${"unknown"} WHERE job_id = ${job.job_id}`;
        this.tasks.moved(job.job_id, "needs_you", "本机执行状态待确认；不会自动重跑。请打开原设备上的执行会话核实。");
      }
    }
  }

  private event(device: Device, event: Event) {
    const job = this.job(event.jobId);
    if (!job || job.device_id !== device.id || !job.lease_id || job.lease_id !== event.leaseId) fail(409, "INVALID_LEASE", "任务不属于这台设备或租约已失效");
    const fingerprint = JSON.stringify({ jobId: event.jobId, leaseId: event.leaseId, type: event.type, summary: event.summary, sessionId: event.sessionId });
    const previous = this.sql<{ job_id: string; fingerprint: string }>`SELECT * FROM res_desktop_events WHERE event_id = ${event.eventId}`[0];
    if (previous) {
      if (previous.job_id !== job.job_id || previous.fingerprint !== fingerprint) fail(409, "EVENT_CONFLICT", "事件标识已用于不同内容");
      return { ok: true, duplicate: true };
    }
    const count = this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM res_desktop_events WHERE job_id = ${job.job_id}`[0]?.n ?? 0;
    if (count >= 64) fail(429, "EVENT_LIMIT", "此任务的事件已达到上限，请核实重复提交");
    if (terminal.has(job.state)) {
      if (job.terminal_event === fingerprint) {
        this.sql`INSERT INTO res_desktop_events VALUES (${event.eventId}, ${job.job_id}, ${fingerprint})`;
        return { ok: true, duplicate: true };
      }
      fail(409, "TERMINAL_CONFLICT", "任务已结束，不能覆盖既有结果");
    }
    if (event.type === "started" && job.state !== "claimed") fail(409, "ALREADY_STARTED", "任务已经开始或执行状态待核实");
    const task = this.tasks.get(job.job_id);
    if (!task || task.runs !== "desktop" || task.deviceId !== device.id) fail(409, "UNKNOWN_JOB", "任务已不存在");
    if (event.sessionId) {
      if (task.desktopSessionId && task.desktopSessionId !== event.sessionId) fail(409, "SESSION_CHANGED", "任务不能改绑到另一会话");
      this.sql`UPDATE res_tasks SET desktop_session_id = ${event.sessionId} WHERE id = ${job.job_id}`;
    }
    this.sql`INSERT INTO res_desktop_events VALUES (${event.eventId}, ${job.job_id}, ${fingerprint})`;
    if (event.type === "started") {
      this.sql`UPDATE res_desktop_jobs SET state = ${"running"}, lease_until = ${Date.now() + LEASE_MS} WHERE job_id = ${job.job_id}`;
      this.tasks.progress(job.job_id, event.summary || "DSH 小帮手正在后台执行");
    } else this.finish(job, event.type, event.summary, fingerprint);
    return { ok: true };
  }

  private finish(job: Job, state: string, summary: string, fingerprint = "") {
    const status = state === "completed" ? "done" : state === "failed" ? "failed" : "needs_you";
    this.sql`UPDATE res_desktop_jobs SET state = ${state}, terminal_event = ${fingerprint} WHERE job_id = ${job.job_id}`;
    if (this.tasks.result(job.job_id, { status, summary, links: [] })) {
      this.sql`INSERT OR IGNORE INTO res_desktop_reports (job_id, delivered) VALUES (${job.job_id}, ${0})`;
    }
  }

  /** Periodic quiet checks update uncertainty, never resubmit a native job. */
  quiet(jobId: string): boolean {
    return this.atomic(() => {
      const job = this.job(jobId);
      if (!job || terminal.has(job.state)) return false;
      this.expire(job.device_id);
      return this.job(jobId)?.state === "queued" || this.job(jobId)?.state === "claimed" || this.job(jobId)?.state === "running";
    });
  }

  pendingReports(): string[] { return this.sql<{ job_id: string }>`SELECT job_id FROM res_desktop_reports WHERE delivered = 0 LIMIT 20`.map(row => row.job_id); }
  reportDelivered(jobId: string) { this.sql`UPDATE res_desktop_reports SET delivered = ${1} WHERE job_id = ${jobId}`; }
}
