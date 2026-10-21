import type { TransactionSql } from "postgres";

import type { Harness } from "../../identity/auth/__tests__/auth-http-harness.ts";

/** An owner session holding rows until it is released, so the API's own requests wait on them. */
export type Holding = { release: () => Promise<void> };

/**
 * Until at least `n` sessions of this database wait on a row lock.
 *
 * @throws Error when fewer than `n` wait after five seconds
 */
export async function rowLockWaiters(h: Harness, n: number): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const [row] = await h.owner`SELECT count(*)::int AS n FROM pg_locks
                                WHERE locktype IN ('transactionid', 'tuple') AND NOT granted`;
    if ((row!["n"] as number) >= n) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fewer than ${n} row-lock waiters`);
}

/**
 * An owner session that takes the locks `lock` takes and holds them until it is released: the API's own
 * lock on those rows (spec §4.4) waits there, so the requests started meanwhile really race.
 *
 * @param lock the statements that take the rows, in the owner's transaction
 * @returns the holding, released by the caller
 */
export async function holdRows(
  h: Harness,
  lock: (sql: TransactionSql) => Promise<unknown>,
): Promise<Holding> {
  let open!: () => void;
  const held = new Promise<void>((resolve) => (open = resolve));
  let locked!: () => void;
  const taken = new Promise<void>((resolve) => (locked = resolve));
  const owner = h.owner.begin(async (sql) => {
    await lock(sql);
    locked();
    await held;
  });
  await taken;
  return {
    release: async () => {
      open();
      await owner;
    },
  };
}

/**
 * Runs `requests` while the rows are held, waits until `waiters` of them wait on the rows, then releases.
 *
 * @returns the answers of the requests, in order
 */
export async function raceOn<T>(
  h: Harness,
  holding: Holding,
  waiters: number,
  requests: readonly (() => Promise<T>)[],
): Promise<T[]> {
  const running = Promise.all(requests.map((request) => request()));
  try {
    await rowLockWaiters(h, waiters);
  } finally {
    await holding.release();
  }
  return running;
}
