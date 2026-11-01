import { owner } from "./export-fixtures.ts";

export interface AccessWait {
  readonly waiters: number;
  readonly self: number;
}

/** Counts the app waiter and this observer in one statement, so the observer cannot count itself. */
export function accessWait(): AccessWait {
  const [waiters, self] = owner(
    `SELECT count(*) FILTER (WHERE pid <> pg_backend_pid() AND usename = 'eyadex_app'
              AND wait_event_type = 'Lock' AND query LIKE '%active_branch_ids%'),
            count(*) FILTER (WHERE pid = pg_backend_pid() AND query LIKE '%active_branch_ids%')
       FROM pg_stat_activity`,
  ).split("|");
  return { waiters: Number(waiters), self: Number(self) };
}

export async function waitForAccessWaiter(): Promise<AccessWait> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const seen = accessWait();
    if (seen.waiters > 0) return seen;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("no eyadex_app waiter on the access snapshot");
}
