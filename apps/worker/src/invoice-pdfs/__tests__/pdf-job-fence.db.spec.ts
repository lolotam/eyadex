import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "@eyadex/db";

import type { PdfFailureCode } from "../domain/pdf-job-failure.ts";
import type { LeasedPdfJob, PdfJobFence } from "../ports/pdf-job-store.ts";
import { PgPdfJobStore } from "../persistence/pg-pdf-job-store.ts";
import {
  holdJobLock,
  insertJob,
  readJob,
  retryWaitJob,
  secondsFromDbNow,
  seedWorld,
  setLeaseWindow,
  urls,
  type World,
} from "./pdf-job-fixtures.ts";
import { clearWriteBlocks, installWriteBlock } from "./pdf-job-write-blocks.ts";

let app: Database;
let store: PgPdfJobStore;

beforeAll(() => {
  const ids = { newId: randomUUID };
  app = createDatabase({ url: urls().app, role: "eyadex_app", ids, transactionTimeoutMs: 20_000 });
  store = new PgPdfJobStore(app, ids);
});

afterAll(async () => {
  clearWriteBlocks();
  await app.close();
});

async function claim(world: World, jobId: string): Promise<LeasedPdfJob> {
  const result = await store.claimNext(world.clinicId);
  expect(result.kind).toBe("claimed");
  if (result.kind !== "claimed") throw new Error("expected a claimed PDF job");
  expect(result.job.jobId).toBe(jobId);
  return result.job;
}

function fenceOf(job: LeasedPdfJob): PdfJobFence {
  return {
    clinicId: job.clinicId,
    jobId: job.jobId,
    attempt: job.attempt,
    fence: job.fence,
    leaseToken: job.leaseToken,
  };
}

function makeDue(world: World, jobId: string): void {
  const row = readJob(world.clinicId, jobId);
  retryWaitJob(world.clinicId, jobId, {
    attempt: row.attempt,
    retryCount: row.retry_count,
    inSeconds: 0,
  });
}

function expectRunningLease(world: World, job: LeasedPdfJob): void {
  expect(readJob(world.clinicId, job.jobId)).toMatchObject({
    status: "running",
    attempt: job.attempt,
    fence: String(job.fence),
    lease_token: job.leaseToken,
    error_code: null,
  });
}

describe("PDF live-fenced heartbeat and failure", () => {
  it("extends a live lease without changing its deadline and caps at that deadline", async () => {
    const world = seedWorld();
    const jobId = insertJob(world);
    const lease = await claim(world, jobId);
    setLeaseWindow(world.clinicId, jobId, 5, 60);
    const deadline = readJob(world.clinicId, jobId).deadline_at;
    await expect(store.heartbeat(fenceOf(lease))).resolves.toEqual({ kind: "applied" });
    const extended = readJob(world.clinicId, jobId);
    expect(extended.deadline_at).toBe(deadline);
    expect(secondsFromDbNow(extended.lease_until!)).toBeGreaterThan(55);
    setLeaseWindow(world.clinicId, jobId, 5, 5);
    const cappedDeadline = readJob(world.clinicId, jobId).deadline_at;
    await expect(store.heartbeat(fenceOf(lease))).resolves.toEqual({ kind: "applied" });
    const capped = readJob(world.clinicId, jobId);
    expect(capped.deadline_at).toBe(cappedDeadline);
    expect(capped.lease_until).toBe(cappedDeadline);
  });

  it("rejects old attempts, fences and tokens independently for both mutations", async () => {
    const world = seedWorld();
    const jobId = insertJob(world);
    const original = await claim(world, jobId);
    await store.recordFailure(fenceOf(original), "store_unavailable");
    makeDue(world, jobId);
    const replacement = await claim(world, jobId);
    const stale = [
      { ...fenceOf(replacement), attempt: original.attempt },
      { ...fenceOf(replacement), fence: original.fence },
      { ...fenceOf(replacement), leaseToken: original.leaseToken },
    ];
    for (const fence of stale) {
      await expect(store.heartbeat(fence)).resolves.toEqual({ kind: "lost_lease" });
      await expect(store.recordFailure(fence, "db_unavailable")).resolves.toEqual({
        kind: "lost_lease",
      });
      expectRunningLease(world, replacement);
    }
  });

  it("rejects heartbeat and failure across clinics", async () => {
    const world = seedWorld();
    const jobId = insertJob(world);
    const lease = await claim(world, jobId);
    const foreign = { ...fenceOf(lease), clinicId: world.otherClinicId };
    await expect(store.heartbeat(foreign)).resolves.toEqual({ kind: "lost_lease" });
    await expect(store.recordFailure(foreign, "invalid_model")).resolves.toEqual({
      kind: "lost_lease",
    });
    expectRunningLease(world, lease);
  });

  it.each(["heartbeat", "failure"] as const)(
    "rechecks an expired deadline after a blocking row lock for %s",
    async (operation) => {
      const world = seedWorld();
      const jobId = insertJob(world);
      const lease = await claim(world, jobId);
      setLeaseWindow(world.clinicId, jobId, 1, 1);
      const hold = holdJobLock(world.clinicId, jobId, 3);
      await hold.ready;
      try {
        const answer =
          operation === "heartbeat"
            ? await store.heartbeat(fenceOf(lease))
            : await store.recordFailure(fenceOf(lease), "store_unavailable");
        expect(answer).toEqual({ kind: "lost_lease" });
        expectRunningLease(world, lease);
      } finally {
        hold.stop();
        await hold.done.catch(() => undefined);
      }
    },
  );

  it("follows claim, 30 seconds, claim, 120 seconds, claim, failed", async () => {
    const world = seedWorld();
    const jobId = insertJob(world);
    const originalSlot = readJob(world.clinicId, jobId).clinic_slot;
    const first = await claim(world, jobId);
    await expect(store.recordFailure(fenceOf(first), "store_unavailable")).resolves.toEqual({
      kind: "applied",
    });
    let row = readJob(world.clinicId, jobId);
    expect(row).toMatchObject({ status: "retry_wait", retry_count: 1, clinic_slot: originalSlot });
    expect(secondsFromDbNow(row.next_attempt_at!)).toBeGreaterThan(25);
    expect(secondsFromDbNow(row.next_attempt_at!)).toBeLessThan(35);
    makeDue(world, jobId);
    const second = await claim(world, jobId);
    await expect(store.recordFailure(fenceOf(second), "db_unavailable")).resolves.toEqual({
      kind: "applied",
    });
    row = readJob(world.clinicId, jobId);
    expect(row).toMatchObject({ status: "retry_wait", retry_count: 2, clinic_slot: originalSlot });
    expect(secondsFromDbNow(row.next_attempt_at!)).toBeGreaterThan(115);
    expect(secondsFromDbNow(row.next_attempt_at!)).toBeLessThan(125);
    makeDue(world, jobId);
    const third = await claim(world, jobId);
    await expect(store.recordFailure(fenceOf(third), "lease_expired")).resolves.toEqual({
      kind: "applied",
    });
    expect(readJob(world.clinicId, jobId)).toMatchObject({
      status: "failed",
      attempt: 3,
      retry_count: 2,
      clinic_slot: null,
      lease_token: null,
      lease_until: null,
      deadline_at: null,
      next_attempt_at: null,
      error_code: "lease_expired",
    });
    expect(readJob(world.clinicId, jobId).cleanup_due_at).not.toBeNull();
  });

  it.each(["invalid_model", "size_limit", "cancelled"] as const)(
    "terminates %s immediately and recognizes its own persisted outcome",
    async (code: PdfFailureCode) => {
      const world = seedWorld();
      const jobId = insertJob(world);
      const lease = await claim(world, jobId);
      await expect(store.recordFailure(fenceOf(lease), code)).resolves.toEqual({ kind: "applied" });
      expect(readJob(world.clinicId, jobId)).toMatchObject({
        status: code === "cancelled" ? "cancelled" : "failed",
        retry_count: 0,
        clinic_slot: null,
        lease_token: null,
        lease_until: null,
        deadline_at: null,
        next_attempt_at: null,
        error_code: code,
      });
      expect(readJob(world.clinicId, jobId).cleanup_due_at).not.toBeNull();
      await expect(store.recordFailure(fenceOf(lease), code)).resolves.toEqual({
        kind: "own_success",
      });
    },
  );

  it("rereads an exact retry as own_success but rejects a different error", async () => {
    const world = seedWorld();
    const jobId = insertJob(world);
    const lease = await claim(world, jobId);
    await store.recordFailure(fenceOf(lease), "store_unavailable");
    const persisted = readJob(world.clinicId, jobId);
    await expect(store.recordFailure(fenceOf(lease), "store_unavailable")).resolves.toEqual({
      kind: "own_success",
    });
    expect(readJob(world.clinicId, jobId)).toEqual(persisted);
    await expect(store.recordFailure(fenceOf(lease), "db_unavailable")).resolves.toEqual({
      kind: "lost_lease",
    });
  });

  it.each(["heartbeat", "failure"] as const)(
    "returns lost_lease and preserves the row on a forced zero-row %s",
    async (operation) => {
      const world = seedWorld();
      const jobId = insertJob(world);
      const lease = await claim(world, jobId);
      if (operation === "heartbeat") setLeaseWindow(world.clinicId, jobId, 5, 60);
      const before = readJob(world.clinicId, jobId);
      installWriteBlock(operation);
      try {
        const answer =
          operation === "heartbeat"
            ? await store.heartbeat(fenceOf(lease))
            : await store.recordFailure(fenceOf(lease), "store_unavailable");
        expect(answer).toEqual({ kind: "lost_lease" });
        expect(readJob(world.clinicId, jobId)).toEqual(before);
      } finally {
        clearWriteBlocks();
      }
    },
  );
});
