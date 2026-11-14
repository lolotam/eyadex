import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, sql, type Database } from "@eyadex/db";

import type { LeasedPdfJob, PdfClaim } from "../ports/pdf-job-store.ts";
import { PgPdfJobStore } from "../persistence/pg-pdf-job-store.ts";
import {
  expireJob,
  holdJobLock,
  insertJob,
  readJob,
  retryWaitJob,
  secondsFromDbNow,
  seedWorld,
  urls,
  type World,
} from "./pdf-job-fixtures.ts";
import { clearWriteBlocks, installWriteBlock } from "./pdf-job-write-blocks.ts";

let app: Database;
let storeA: PgPdfJobStore;
let storeB: PgPdfJobStore;

beforeAll(() => {
  const ids = { newId: randomUUID };
  app = createDatabase({ url: urls().app, role: "eyadex_app", ids, transactionTimeoutMs: 20_000 });
  storeA = new PgPdfJobStore(app, ids);
  storeB = new PgPdfJobStore(app, ids);
});

afterAll(async () => {
  clearWriteBlocks();
  await app.close();
});

function claimed(result: PdfClaim): LeasedPdfJob {
  expect(result.kind).toBe("claimed");
  if (result.kind !== "claimed") throw new Error("expected a claimed PDF job");
  return result.job;
}

function expectLease(job: LeasedPdfJob, world: World, jobId: string): void {
  expect(job).toMatchObject({ clinicId: world.clinicId, jobId, attempt: 1, fence: 1n });
  expect(typeof job.attempt).toBe("number");
  expect(typeof job.fence).toBe("bigint");
  expect(job.leaseToken).toMatch(/^[0-9a-f-]{36}$/);
  expect(job.leaseUntil).toBeInstanceOf(Date);
  expect(job.deadlineAt).toBeInstanceOf(Date);
  expect(job.leaseUntil.getTime()).toBe(job.deadlineAt.getTime());
  expect(secondsFromDbNow(job.leaseUntil.toISOString())).toBeGreaterThan(55);
  expect(secondsFromDbNow(job.leaseUntil.toISOString())).toBeLessThan(65);
}

describe("PDF oldest-due claim", () => {
  it("claims oldest first and returns distinct typed sixty-second leases", async () => {
    const world = seedWorld();
    const oldest = insertJob(world, { createdSecondsAgo: 120 });
    const newest = insertJob(world, { createdSecondsAgo: 60 });
    const role = await app.withTenant(world.clinicId, async (tx) => {
      const rows = await tx.execute<{ role: string }>(sql`SELECT current_user AS role`);
      return rows[0]?.role;
    });
    expect(role).toBe("eyadex_app");
    const first = claimed(await storeA.claimNext(world.clinicId));
    const second = claimed(await storeA.claimNext(world.clinicId));
    expect(first.jobId).toBe(oldest);
    expect(second.jobId).toBe(newest);
    expect(first.leaseToken).not.toBe(second.leaseToken);
    expectLease(first, world, oldest);
    expectLease(second, world, newest);
    expect(readJob(world.clinicId, oldest)).toMatchObject({
      status: "running",
      attempt: 1,
      fence: "1",
    });
  });

  it("lets only one of two concurrent stores claim the same row", async () => {
    const world = seedWorld();
    const jobId = insertJob(world);
    const [a, b] = await Promise.all([
      storeA.claimNext(world.clinicId),
      storeB.claimNext(world.clinicId),
    ]);
    expect([a, b].filter((x) => x.kind === "claimed")).toHaveLength(1);
    expect(readJob(world.clinicId, jobId)).toMatchObject({
      status: "running",
      attempt: 1,
      fence: "1",
    });
  });

  it("defers future retry_wait and cannot see another clinic", async () => {
    const world = seedWorld();
    const waiting = insertJob(world);
    const foreign = insertJob(world, { otherClinic: true });
    retryWaitJob(world.clinicId, waiting);
    await expect(storeA.claimNext(world.clinicId)).resolves.toEqual({ kind: "empty" });
    expect(readJob(world.clinicId, waiting)).toMatchObject({
      status: "retry_wait",
      attempt: 1,
      fence: "1",
    });
    const other = claimed(await storeB.claimNext(world.otherClinicId));
    expect(other.jobId).toBe(foreign);
    expect(other.clinicId).toBe(world.otherClinicId);
  });

  it("skips a locked oldest candidate and claims another due row without waiting", async () => {
    const world = seedWorld();
    const locked = insertJob(world, { createdSecondsAgo: 120 });
    const available = insertJob(world, { createdSecondsAgo: 60 });
    const hold = holdJobLock(world.clinicId, locked);
    await hold.ready;
    try {
      const result = claimed(await storeA.claimNext(world.clinicId));
      expect(result.jobId).toBe(available);
      expect(readJob(world.clinicId, locked)).toMatchObject({
        status: "queued",
        attempt: 0,
        fence: "0",
      });
    } finally {
      hold.stop();
      await hold.done.catch(() => undefined);
    }
  });

  it.each([
    { attempt: 1, retries: 0, expectedRetries: 1, delay: 30, status: "retry_wait", slot: 1 },
    { attempt: 2, retries: 1, expectedRetries: 2, delay: 120, status: "retry_wait", slot: 1 },
    { attempt: 3, retries: 2, expectedRetries: 2, delay: null, status: "failed", slot: null },
  ])("recovers expired attempt $attempt and commits an empty claim", async (example) => {
    const world = seedWorld();
    const jobId = insertJob(world);
    const originalSlot = readJob(world.clinicId, jobId).clinic_slot;
    expireJob(world.clinicId, jobId, example.attempt, example.retries);
    await expect(storeA.claimNext(world.clinicId)).resolves.toEqual({ kind: "empty" });
    const row = readJob(world.clinicId, jobId);
    expect(row).toMatchObject({
      status: example.status,
      attempt: example.attempt,
      retry_count: example.expectedRetries,
      fence: String(example.attempt),
      lease_token: null,
      lease_until: null,
      deadline_at: null,
      error_code: "lease_expired",
    });
    if (example.slot === null) expect(row.clinic_slot).toBeNull();
    else expect(row.clinic_slot).toBe(originalSlot);
    if (example.delay === null) {
      expect(row.next_attempt_at).toBeNull();
      expect(row.cleanup_due_at).not.toBeNull();
    } else {
      expect(row.next_attempt_at).not.toBeNull();
      expect(secondsFromDbNow(row.next_attempt_at!)).toBeGreaterThan(example.delay - 5);
      expect(secondsFromDbNow(row.next_attempt_at!)).toBeLessThan(example.delay + 5);
      expect(row.cleanup_due_at).toBeNull();
    }
  });

  it("increments retry_count once under competing recovery", async () => {
    const world = seedWorld();
    const jobId = insertJob(world);
    expireJob(world.clinicId, jobId, 1, 0);
    const answers = await Promise.all([
      storeA.claimNext(world.clinicId),
      storeB.claimNext(world.clinicId),
    ]);
    expect(answers).toEqual([{ kind: "empty" }, { kind: "empty" }]);
    expect(readJob(world.clinicId, jobId)).toMatchObject({ status: "retry_wait", retry_count: 1 });
  });

  it("keeps one claim owner while another store performs recovery", async () => {
    const world = seedWorld();
    const expired = insertJob(world, { createdSecondsAgo: 120 });
    const queued = insertJob(world, { createdSecondsAgo: 60 });
    expireJob(world.clinicId, expired, 1, 0);
    const answers = await Promise.all([
      storeA.claimNext(world.clinicId),
      storeB.claimNext(world.clinicId),
    ]);
    expect(answers.filter((answer) => answer.kind === "claimed")).toHaveLength(1);
    expect(readJob(world.clinicId, expired)).toMatchObject({
      status: "retry_wait",
      retry_count: 1,
    });
    expect(readJob(world.clinicId, queued)).toMatchObject({
      status: "running",
      attempt: 1,
      fence: "1",
    });
  });

  it("rolls back completed recovery when the selected claim update misses", async () => {
    const world = seedWorld();
    const expired = insertJob(world, { createdSecondsAgo: 120 });
    const queued = insertJob(world, { createdSecondsAgo: 60 });
    expireJob(world.clinicId, expired, 1, 0);
    installWriteBlock("claim");
    try {
      await expect(storeA.claimNext(world.clinicId)).resolves.toEqual({ kind: "empty" });
      expect(readJob(world.clinicId, expired)).toMatchObject({ status: "running", retry_count: 0 });
      expect(readJob(world.clinicId, queued)).toMatchObject({
        status: "queued",
        attempt: 0,
        fence: "0",
      });
    } finally {
      clearWriteBlocks();
    }
  });

  it("recovers all ten expired jobs allowed by per-clinic capacity", async () => {
    const world = seedWorld();
    const jobs = Array.from({ length: 10 }, () => insertJob(world));
    const originalSlots = new Map(
      jobs.map((jobId) => [jobId, readJob(world.clinicId, jobId).clinic_slot]),
    );
    for (const jobId of jobs) expireJob(world.clinicId, jobId, 1, 0);
    await expect(storeA.claimNext(world.clinicId)).resolves.toEqual({ kind: "empty" });
    for (const jobId of jobs) {
      expect(readJob(world.clinicId, jobId)).toMatchObject({
        status: "retry_wait",
        retry_count: 1,
        clinic_slot: originalSlots.get(jobId),
      });
    }
  });

  it("propagates a recovery miss and rolls back recovery and claim", async () => {
    const world = seedWorld();
    const expired = insertJob(world, { createdSecondsAgo: 120 });
    const queued = insertJob(world, { createdSecondsAgo: 60 });
    expireJob(world.clinicId, expired, 1, 0);
    installWriteBlock("recovery");
    try {
      await expect(storeA.claimNext(world.clinicId)).rejects.toMatchObject({
        name: "PdfRecoveryMiss",
      });
      expect(readJob(world.clinicId, expired)).toMatchObject({ status: "running", retry_count: 0 });
      expect(readJob(world.clinicId, queued)).toMatchObject({ status: "queued", attempt: 0 });
    } finally {
      clearWriteBlocks();
    }
  });

  it("propagates an unexpected claim error and rolls back recovery", async () => {
    const world = seedWorld();
    const expired = insertJob(world, { createdSecondsAgo: 120 });
    const queued = insertJob(world, { createdSecondsAgo: 60 });
    expireJob(world.clinicId, expired, 1, 0);
    installWriteBlock("claim", "error");
    try {
      await expect(storeA.claimNext(world.clinicId)).rejects.toMatchObject({
        name: "DatabaseError",
      });
      expect(readJob(world.clinicId, expired)).toMatchObject({ status: "running", retry_count: 0 });
      expect(readJob(world.clinicId, queued)).toMatchObject({
        status: "queued",
        attempt: 0,
        fence: "0",
      });
    } finally {
      clearWriteBlocks();
    }
  });
});
