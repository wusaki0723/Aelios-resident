// Shared by the runner tests: a runner wired to a fake resident and a fake ACP helper, in a throwaway folder.
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Runner } from "../src/runner.mjs";
import { StateFile } from "../src/state.mjs";
import { FakeCloud } from "./fake-cloud.mjs";

const AGENT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-agent.mjs");
chmodSync(AGENT, 0o755);

export async function rig(plugin, extra = {}) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "runner-test-")));
  const cloud = await new FakeCloud().listen();
  const store = path.join(dir, "agent.json");
  writeFileSync(store, JSON.stringify({ sessions: {}, log: [], n: 0 }));
  const workspace = path.join(dir, "work");
  const config = { url: cloud.url, resident: "default", workspace, access: "edit", plugin, bin: AGENT, env: { FAKE_STORE: store },
    pollMs: 20, heartbeatMs: 20, killAfterMs: 400, ...extra };
  const state = new StateFile(path.join(dir, "state.json"));
  await state.update(s => { s.device = { runnerId: "run_1", token: cloud.deviceToken }; });
  const rig = { dir, cloud, state, config, workspace, store, stopped: false };
  rig.log = () => JSON.parse(readFileSync(store, "utf8")).log;
  rig.prompts = () => rig.log().filter(e => e.event === "prompt");
  rig.start = () => {
    rig.control = new AbortController();
    rig.runner = new Runner({ config, state });
    rig.loop = rig.runner.start(rig.control.signal);
  };
  rig.stop = async () => { if (rig.control && !rig.stopped) { rig.stopped = true; rig.control.abort(); await rig.loop; } };
  rig.done = async () => { await rig.stop(); await cloud.close(); rmSync(dir, { recursive: true, force: true }); };
  return rig;
}
export const final = (r, work) => r.cloud.until(() => r.cloud.finals(work.workId)[0], "final of " + work.workId);

