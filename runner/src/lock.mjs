// One runner process per folder: state.json has a single writer. The lock file holds the owner's pid.
// shortcut: a stale lock is judged by "is that pid alive", so a reused pid keeps it; delete the file by hand then.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };

/** The pid of a live owner, or null. */
export function holder(file) {
  try {
    const pid = Number(readFileSync(file, "utf8"));
    return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : null;
  } catch { return null; }
}

/** Take the lock or throw. Returns the function that gives it back. */
export function acquire(file) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 });
      return () => { try { if (readFileSync(file, "utf8") === String(process.pid)) rmSync(file, { force: true }); } catch { /* already gone */ } };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = holder(file);
      if (pid) throw new Error(`another aelios-runner (pid ${pid}) is already using ${path.dirname(file)}`);
      rmSync(file, { force: true }); // its owner is gone
    }
  }
  throw new Error("could not take the lock");
}

/** Ask the running owner to stop (SIGTERM) and wait for it to let go. False when nobody was running. */
export async function stopHolder(file, waitMs = 30_000) {
  const pid = holder(file);
  if (!pid) return false;
  process.kill(pid, "SIGTERM");
  const end = Date.now() + waitMs;
  while (holder(file) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 100));
  if (holder(file)) throw new Error(`the running aelios-runner (pid ${pid}) did not stop`);
  return true;
}
