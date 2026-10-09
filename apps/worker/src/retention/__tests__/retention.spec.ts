import { Writable } from "node:stream";

import type { RetentionTarget } from "@eyadex/db";
import { createLogger } from "@eyadex/observability";
import { describe, expect, it } from "vitest";

import { WORKER_LOG_EVENTS } from "../../shared/log-events.ts";
import { MAX_BATCHES_PER_RUN, PURGE_BATCH_SIZE } from "../domain/retention-batches.ts";
import type { RetentionPurger } from "../ports/retention-purger.ts";
import { RetentionPurgeJob } from "../purge-expired-rows.ts";

function logs() {
  const lines: string[] = [];
  const sink = new Writable({
    write: (chunk, _e, done) => {
      lines.push(String(chunk));
      done();
    },
  });
  return { lines, logger: createLogger("info", { destination: sink, events: WORKER_LOG_EVENTS }) };
}

/** A ledger per target holding `rows` expired rows; every call is recorded. */
function ledgers(rows: Partial<Record<RetentionTarget, number>>, failing?: RetentionTarget) {
  const left = { outbox: 0, platformLedger: 0, clinicLedger: 0, ...rows };
  const calls: [RetentionTarget, number][] = [];
  const purger: RetentionPurger = {
    purgeExpired: async (target, limit) => {
      calls.push([target, limit]);
      if (target === failing)
        throw new Error("function purge_expired_outbox_events does not exist");
      const deleted = Math.min(limit, left[target]);
      left[target] -= deleted;
      return deleted;
    },
  };
  return { purger, calls, left };
}

const job = (purger: RetentionPurger, extra: { batchSize?: number; maxBatches?: number } = {}) =>
  new RetentionPurgeJob({ purger, logger: logs().logger, intervalMs: 60_000, ...extra });

describe("the retention purge (ADR-0022)", () => {
  it("drains every ledger in bounded batches until a short batch, and a second run deletes nothing", async () => {
    const { purger, calls } = ledgers({ outbox: 5, platformLedger: 4, clinicLedger: 0 });
    const purge = job(purger, { batchSize: 2 });
    expect(await purge.runOnce()).toEqual({
      purged: { outbox: 5, platformLedger: 4, clinicLedger: 0 },
      backlog: [],
      failed: [],
    });
    expect(calls).toEqual([
      ["outbox", 2],
      ["outbox", 2],
      ["outbox", 2],
      ["platformLedger", 2],
      ["platformLedger", 2],
      ["platformLedger", 2],
      ["clinicLedger", 2],
    ]);
    expect((await purge.runOnce()).purged).toEqual({
      outbox: 0,
      platformLedger: 0,
      clinicLedger: 0,
    });
  });

  it("stops a ledger at the batch limit and leaves the rest to the next run", async () => {
    const { purger, left } = ledgers({ clinicLedger: 10 });
    const purge = job(purger, { batchSize: 2, maxBatches: 3 });
    const first = await purge.runOnce();
    expect(first.purged.clinicLedger).toBe(6);
    expect(first.backlog).toEqual(["clinicLedger"]);
    expect(left.clinicLedger).toBe(4);
    const second = await purge.runOnce();
    expect(second.purged.clinicLedger).toBe(4);
    expect(second.backlog).toEqual([]);
  });

  it("uses the default batch size under the function's cap of 1000, with a bounded run", async () => {
    expect(PURGE_BATCH_SIZE).toBeGreaterThan(0);
    expect(PURGE_BATCH_SIZE).toBeLessThanOrEqual(1000);
    const { purger, calls } = ledgers({ outbox: PURGE_BATCH_SIZE * (MAX_BATCHES_PER_RUN + 1) });
    const run = await job(purger).runOnce();
    expect(run.purged.outbox).toBe(PURGE_BATCH_SIZE * MAX_BATCHES_PER_RUN);
    expect(run.backlog).toEqual(["outbox"]);
    expect(calls.every(([, limit]) => limit === PURGE_BATCH_SIZE)).toBe(true);
  });

  it("NEGATIVE: one failing ledger does not stop the others, and the log carries counts only", async () => {
    const { purger } = ledgers({ outbox: 3, platformLedger: 1, clinicLedger: 1 }, "outbox");
    const { lines, logger } = logs();
    const purge = new RetentionPurgeJob({ purger, logger, intervalMs: 60_000 });
    purge.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await purge.stop();
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const failed = records.find((r) => r["msg"] === "retention purge failed");
    expect(failed?.["retention"]).toEqual({ target: "outbox" });
    const done = records.find((r) => r["msg"] === "retention purge completed");
    expect(done?.["retention"]).toEqual({
      purged: { outbox: 0, platformLedger: 1, clinicLedger: 1 },
      backlog: [],
      failed: ["outbox"],
    });
  });

  it("runs at start, then waits; stop lets the batch in flight finish and starts no other", async () => {
    let release: () => void = () => undefined;
    let calls = 0;
    const purger: RetentionPurger = {
      purgeExpired: async () => {
        calls += 1;
        await new Promise<void>((resolve) => (release = resolve));
        return 500;
      },
    };
    const purge = job(purger);
    purge.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(1);
    const stopped = purge.stop();
    release();
    await stopped;
    expect(calls).toBe(1);
  });
});
