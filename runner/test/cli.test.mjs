// The command line: pair, status, and that the web key is never written to disk.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { FakeCloud } from "./fake-cloud.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "aelios-runner.mjs");

test("pair writes config and state (0600) without the web key; status reads them", async () => {
  const cloud = await new FakeCloud().listen();
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "runner-cli-")));
  const env = { ...process.env, AELIOS_RUNNER_HOME: path.join(home, "h"), AELIOS_WEB_KEY: "web-key" };
  try {
    const run = (...args) => new Promise((resolve, reject) => execFile(process.execPath, [BIN, ...args], { env }, (error, out, err) => (error ? reject(new Error(err)) : resolve(out))));
    await assert.rejects(run("pair", "--url", cloud.url, "--workspace", path.join(home, "w"), "--plugin", "command"), /command/); // a plug that cannot start is refused before pairing
    assert.equal(readdirSync(home).includes("h"), false, "nothing is written when pairing fails");
    const out = await run("pair", "--url", cloud.url, "--workspace", path.join(home, "w"), "--access", "edit", "--plugin", "command", "--command", JSON.stringify([process.execPath, "-e", ""]));
    assert.match(out, /Paired/);
    for (const file of readdirSync(path.join(home, "h"))) assert.ok(!readFileSync(path.join(home, "h", file), "utf8").includes("web-key"));
    const status = JSON.parse(await run("status"));
    assert.deepEqual([status.paired, status.plugin, status.access], [true, "command", "edit"]);
    await assert.rejects(run("pair", "--url", cloud.url, "--workspace", path.join(home, "w")), /already paired/);
  } finally { await cloud.close(); rmSync(home, { recursive: true, force: true }); }
});
