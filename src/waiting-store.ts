// Reads what the waiting list is made of, and keeps two small things: which items were read, and which asks were pushed.
import type { TaskStore } from "./cloud-tasks";
import type { MachineStore } from "./machine";
import type { Sql } from "./sticker-store";
import { ITEM_DROPPED_MS, askPush, build, type WaitingItem } from "./waiting";

const THREADS_LOOKED_AT = 100;

export class WaitingStore {
  constructor(private readonly sql: Sql, private readonly tasks: TaskStore, private readonly machines: MachineStore) {
    sql`CREATE TABLE IF NOT EXISTS res_waiting_seen (id TEXT PRIMARY KEY, at INTEGER NOT NULL)`;
  }

  /** The list, and how many asks are open in it. */
  list(now = Date.now()): { items: WaitingItem[]; open: number } {
    this.sql`DELETE FROM res_waiting_seen WHERE at < ${now - ITEM_DROPPED_MS}`;
    const threads = this.tasks.threads(THREADS_LOOKED_AT).flatMap((card) => {
      const task = this.tasks.latest(card.id);
      return task && !task.test && task.runs !== "retired"
        ? [{ id: card.id, taskId: task.id, title: card.title, status: task.status, runs: task.runs, summary: task.summary, choices: task.choices ?? [], waiting: card.waiting, updatedAt: task.updatedAt }]
        : [];
    });
    const seen = new Set(this.sql<{ id: string }>`SELECT id FROM res_waiting_seen`.map((row) => row.id));
    const items = build({ asks: this.machines.allAsks(), notes: this.machines.notes(), threads, seen, now });
    return { items, open: items.filter((item) => item.kind === "ask" && !item.expired).length };
  }

  /** The owner read one item, or all of the ones that need no answer. */
  read(id: string | null): void {
    const now = Date.now();
    for (const item of this.list(now).items) {
      if (item.kind !== "ask" && (id === null || item.id === id)) this.sql`INSERT OR REPLACE INTO res_waiting_seen VALUES (${item.id}, ${now})`;
    }
  }

  /** The pushes still to send: each open ask once. */
  unpushed(): { body: string; tag: string }[] {
    const out: { body: string; tag: string }[] = [];
    for (const item of this.list().items) {
      if (item.kind !== "ask" || item.expired) continue;
      const mark = `push:${item.id}`;
      if (this.sql`SELECT 1 FROM res_waiting_seen WHERE id = ${mark}`.length) continue;
      this.sql`INSERT INTO res_waiting_seen VALUES (${mark}, ${Date.now()})`;
      out.push(askPush(item));
    }
    return out;
  }
}
