// Everything the runner must not forget across a restart: the pairing token, thread → session, the work it has
// been handed, and receipts not yet accepted. One JSON file, written whole and swapped in, readable by its owner only.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const homeDir = () => process.env.AELIOS_RUNNER_HOME || path.join(os.homedir(), ".aelios-runner");
export const emptyState = () => ({ version: 1, device: null, threads: {}, claimKey: null, current: null, queue: [], outbox: [] });

export class StateFile {
  constructor(file) { this.file = file; this.chain = Promise.resolve(); this.cache = null; }
  async read() {
    if (this.cache) return structuredClone(this.cache);
    try { this.cache = { ...emptyState(), ...JSON.parse(await readFile(this.file, "utf8")) }; }
    catch (error) { if (error.code !== "ENOENT") throw error; this.cache = emptyState(); }
    return structuredClone(this.cache);
  }
  /** Changes are applied one after another; the file only ever holds a whole, consistent state. */
  update(change) {
    const run = this.chain.then(async () => {
      const next = await this.read();
      const result = await change(next);
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = this.file + ".tmp";
      await writeFile(temp, JSON.stringify(next), { mode: 0o600 });
      await rename(temp, this.file);
      this.cache = next;
      return result;
    });
    this.chain = run.catch(() => {});
    return run;
  }
}

export async function readConfig(file) {
  let config;
  try { config = JSON.parse(await readFile(file, "utf8")); }
  catch (error) { throw new Error(error.code === "ENOENT" ? `no config at ${file}; run "aelios-runner pair" first` : `config is not valid JSON: ${file}`); }
  return config;
}
export async function writeConfig(file, config) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}
