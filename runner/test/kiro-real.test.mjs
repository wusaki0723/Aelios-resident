// Proves the real `kiro-cli acp` can be started and answers initialize. It sends no prompt, so it uses no quota.
// Off by default. Run: AELIOS_REAL_KIRO=1 node --test test/kiro-real.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { AcpConnection, PROTOCOL_VERSION } from "../src/acp.mjs";
import { launchOf } from "../src/plugins.mjs";

test("real kiro-cli acp answers initialize", { skip: !process.env.AELIOS_REAL_KIRO }, async () => {
  const launch = launchOf({ plugin: "kiro" }, "read");
  const connection = new AcpConnection({ ...launch, cwd: process.cwd() }).start();
  try {
    const init = await connection.request("initialize", { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {}, clientInfo: { name: "aelios-runner-test", version: "0" } }, 30_000);
    console.log(JSON.stringify({ protocolVersion: init.protocolVersion, agentInfo: init.agentInfo, loadSession: init.agentCapabilities?.loadSession, sessionCapabilities: init.agentCapabilities?.sessionCapabilities, authMethods: init.authMethods?.map(m => m.id) }));
    assert.equal(init.protocolVersion, PROTOCOL_VERSION);
  } finally { await connection.close(); }
});
