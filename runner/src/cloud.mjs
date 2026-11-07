// The runner's side of aelios-runner/1 (see ../PROTOCOL.md). Only outbound requests.
export const PROTOCOL = "aelios-runner/1";

export class CloudError extends Error {
  constructor(message, status, code) { super(message); this.name = "CloudError"; this.status = status; this.code = code; }
  /** Worth sending again later: no answer, rate limit or a server fault. Anything else will never be accepted. */
  get retry() { return this.status === 0 || this.status === 429 || this.status >= 500; }
  get revoked() { return this.status === 401 || this.status === 403; }
}

export const residentPath = id => {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,24}$/.test(id)) throw new Error("resident id is not valid");
  return id === "default" ? "" : `/r/${id}`;
};

async function call(request, url, init) {
  let response;
  try { response = await request(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000), ...init }); }
  catch { throw new CloudError("cannot reach the resident", 0, "NETWORK"); }
  let body = null;
  try { body = JSON.parse((await response.text()).slice(0, 2_000_000)); } catch { /* not JSON */ }
  if (!response.ok) throw new CloudError(`resident answered ${response.status}`, response.status, typeof body?.code === "string" ? body.code : "");
  if (!body || typeof body !== "object" || body.error) throw new CloudError("resident sent no usable answer", 502, "BAD_BODY");
  return body;
}

/** Pairing happens once, with the web key; the key is never kept. */
export async function register({ url, resident, webKey, label, request = fetch }) {
  const body = await call(request, url + residentPath(resident) + "/web/runner/register", {
    headers: { "x-web-key": webKey, "content-type": "application/json" }, body: JSON.stringify({ label })
  });
  if (typeof body.runnerId !== "string" || typeof body.token !== "string" || body.protocol !== PROTOCOL) throw new CloudError("the resident does not speak " + PROTOCOL, 502, "PROTOCOL");
  return { runnerId: body.runnerId, token: body.token };
}

export async function revoke({ url, resident, webKey, runnerId, request = fetch }) {
  await call(request, url + residentPath(resident) + "/web/runner/revoke", {
    headers: { "x-web-key": webKey, "content-type": "application/json" }, body: JSON.stringify({ runnerId })
  });
}

export class Cloud {
  constructor({ url, resident, token, request = fetch }) { this.base = url + residentPath(resident) + "/runner/v1/"; this.token = token; this.request = request; }
  #post(action, body) {
    return call(this.request, this.base + action, { headers: { authorization: "Bearer " + this.token, "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  heartbeat(body) { return this.#post("heartbeat", body); }
  poll(body) { return this.#post("poll", body); }
  receipt(body) { return this.#post("receipt", body); }
}
