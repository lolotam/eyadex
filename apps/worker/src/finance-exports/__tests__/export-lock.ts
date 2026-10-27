import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { owner, urls } from "./export-fixtures.ts";

export interface LockHold {
  readonly ready: Promise<void>;
  readonly done: Promise<void>;
  stop(): void;
}

const RELATIONS = new Set(["finance_report_exports", "finance_report_export_blobs", "audit_log"]);

/** Holds an owner transaction across pg_sleep. The barrier is this backend's PGAPPNAME, not the observer query. */
export function holdLock(lockSql: string, seconds: number, afterSleep = ""): LockHold {
  const marker = `eyadex-fence-${randomUUID().replace(/-/g, "")}`;
  const dir = mkdtempSync(join(tmpdir(), "eyadex-fence-"));
  const file = join(dir, "hold.sql");
  const tail = afterSleep === "" ? "" : `${afterSleep};\n`;
  writeFileSync(
    file,
    `BEGIN;\n${lockSql};\nSELECT pg_sleep(${seconds});\n${tail}COMMIT;\n`,
    "ascii",
  );
  let exited: number | null = null;
  const child: ChildProcess = spawn("psql", [urls().owner, "-v", "ON_ERROR_STOP=1", "-f", file], {
    stdio: "ignore",
    env: { ...process.env, PGAPPNAME: marker },
  });
  const done = new Promise<void>((resolve, reject) => {
    child.once("error", (error) => {
      exited = 1;
      rmSync(dir, { recursive: true, force: true });
      reject(error);
    });
    child.once("exit", (code) => {
      exited = code ?? 1;
      rmSync(dir, { recursive: true, force: true });
      if (code === 0) resolve();
      else reject(new Error(`psql lock holder exited ${code}`));
    });
  });
  const ready = (async () => {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (exited !== null) throw new Error(`lock holder exited before PgSleep (${exited})`);
      const held = owner(
        `SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND application_name = '${marker}' AND wait_event = 'PgSleep'`,
      );
      if (held === "1") return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    child.kill();
    throw new Error("lock holder did not reach PgSleep");
  })();
  return {
    ready,
    done,
    stop() {
      child.kill();
    },
  };
}

/** Counts other backends blocked on a known relation, including tuple locks that pg_locks may not list as ungranted. */
export function ungrantedLocks(relation: string): number {
  if (!RELATIONS.has(relation)) throw new Error("unknown relation");
  return Number(
    owner(
      `SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%${relation}%'`,
    ),
  );
}

/** Bounded wait until some other backend is blocked on the relation the holder already owns. */
export async function waitForUngranted(relation: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (ungrantedLocks(relation) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`no waiter on ${relation}`);
}
