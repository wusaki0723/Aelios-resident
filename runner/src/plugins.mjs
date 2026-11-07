// A plug is only "how to start the helper". Everything else (sessions, cancel, permissions) is shared in helper.mjs.
// The helper is chosen by this machine's config, never by a job.
import { accessSync, constants } from "node:fs";
import path from "node:path";

const DSH_APP = "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh";

function onPath(name) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    try { accessSync(path.join(dir, name), constants.X_OK); return path.join(dir, name); } catch { /* next */ }
  }
  return null;
}

export const PLUGINS = {
  // kiro-cli acp. Kiro asks for its own tool trust on the command line, so the "full" tier also opens it there.
  kiro: {
    bin: () => onPath("kiro-cli") ?? "kiro-cli",
    args: tier => ["acp", ...(tier === "full" ? ["--trust-all-tools"] : [])]
  },
  // dsh --profile acp (DeepSeek Harness's automation-only ACP server). It resumes with session/resume, not session/load.
  dsh: {
    bin: () => onPath("dsh") ?? (process.platform === "darwin" && onPath(DSH_APP) ? DSH_APP : "dsh"),
    args: () => ["--profile", "acp"]
  },
  // Any other ACP helper (e.g. Claude Code's adapter, experimental): config.command = ["bin", "arg", ...].
  command: { bin: () => null, args: () => [] }
};

/** @returns {{command: string, args: string[], env: Record<string,string>}} */
export function launchOf(config, tier) {
  const plug = PLUGINS[config.plugin];
  if (!plug) throw new Error(`unknown plugin "${config.plugin}"; use one of ${Object.keys(PLUGINS).join(", ")}`);
  if (config.plugin === "command") {
    if (!Array.isArray(config.command) || !config.command.length || config.command.some(part => typeof part !== "string")) throw new Error('plugin "command" needs config.command: ["bin", "arg", ...]');
    return { command: config.command[0], args: config.command.slice(1), env: config.env ?? {} };
  }
  const bin = config.bin ?? process.env[`AELIOS_RUNNER_${config.plugin.toUpperCase()}_BIN`] ?? plug.bin();
  return { command: bin, args: [...plug.args(tier), ...(config.args ?? [])], env: config.env ?? {} };
}
