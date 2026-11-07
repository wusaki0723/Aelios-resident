#!/usr/bin/env node
// aelios-runner pair | start | status | unpair   (see ../README.md)
import { mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { register, revoke } from "../src/cloud.mjs";
import { PLUGINS, launchOf } from "../src/plugins.mjs";
import { tierOf } from "../src/permission.mjs";
import { Runner } from "../src/runner.mjs";
import { StateFile, homeDir, readConfig, writeConfig } from "../src/state.mjs";

const [command, ...rest] = process.argv.slice(2);
const home = homeDir();
const configFile = path.join(home, "config.json");
const state = new StateFile(path.join(home, "state.json"));

/** The web key comes from AELIOS_WEB_KEY or one line on stdin. It is used once and never written down. */
async function webKey() {
  if (process.env.AELIOS_WEB_KEY) return process.env.AELIOS_WEB_KEY.trim();
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try { return (await rl.question("Web key (WEB_KEY): ")).trim(); } finally { rl.close(); }
}

async function pair() {
  const { values } = parseArgs({ args: rest, options: {
    url: { type: "string" }, resident: { type: "string", default: "default" }, workspace: { type: "string" },
    access: { type: "string", default: "read" }, plugin: { type: "string", default: "kiro" }, label: { type: "string", default: "Runner" }, command: { type: "string" }
  } });
  if (!values.url?.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(values.url ?? "")) throw new Error("--url must be the resident's https address");
  if (!values.workspace || !path.isAbsolute(values.workspace)) throw new Error("--workspace must be an absolute folder path");
  if (!tierOf(values.access)) throw new Error("--access is read, edit or full");
  if (!PLUGINS[values.plugin]) throw new Error(`--plugin is one of ${Object.keys(PLUGINS).join(", ")}`);
  mkdirSync(values.workspace, { recursive: true });
  const config = { url: values.url.replace(/\/+$/, ""), resident: values.resident, workspace: realpathSync(values.workspace), access: values.access, plugin: values.plugin };
  if (values.command) config.command = JSON.parse(values.command);
  launchOf(config, config.access); // fails now, not on the first job, if the plugin is not set up
  if ((await state.read()).device) throw new Error('already paired; run "aelios-runner unpair" first');
  const device = await register({ url: config.url, resident: config.resident, webKey: await webKey(), label: values.label });
  await state.update(s => { s.device = device; });
  await writeConfig(configFile, config);
  console.log(`Paired. Plugin ${config.plugin}, access ${config.access}, folder ${config.workspace}.\nStart with: aelios-runner start`);
}

async function start() {
  const config = await readConfig(configFile);
  if (!(await state.read()).device) throw new Error('not paired; run "aelios-runner pair" first');
  const control = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => control.abort());
  const runner = new Runner({ config, state, log: (...args) => console.error(new Date().toISOString(), ...args) });
  console.error(`aelios-runner: ${config.plugin}, access ${config.access}, folder ${config.workspace}`);
  await runner.start(control.signal);
}

async function status() {
  const config = await readConfig(configFile), s = await state.read();
  console.log(JSON.stringify({ paired: Boolean(s.device), revoked: Boolean(s.device?.revoked), plugin: config.plugin, access: config.access, workspace: config.workspace,
    threads: Object.keys(s.threads).length, queued: s.queue.length, running: s.current?.workId ?? null, unsentReceipts: s.outbox.length }, null, 2));
}

async function unpair() {
  const config = await readConfig(configFile), s = await state.read();
  if (!s.device) return console.log("Not paired.");
  try { await revoke({ url: config.url, resident: config.resident, webKey: await webKey(), runnerId: s.device.runnerId }); }
  catch (error) { console.error("The resident did not confirm the revoke (" + error.message + "). Revoke this runner from the web page too."); }
  await state.update(next => { next.device = null; next.claimKey = null; });
  console.log("Unpaired. Threads, queue and unsent receipts are kept.");
}

const commands = { pair, start, status, unpair };
if (!commands[command]) { console.error("usage: aelios-runner pair|start|status|unpair"); process.exit(2); }
commands[command]().catch(error => { console.error("aelios-runner:", error.message); process.exit(1); });
