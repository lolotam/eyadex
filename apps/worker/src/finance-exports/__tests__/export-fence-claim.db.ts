import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { FINANCE_REPORT_EXPORT_REQUESTED } from "../domain/export-event.ts";
import { handleExportRequested } from "../handle-export-requested.ts";
import { fence } from "./export-fence-bind.ts";
import {
  insertExport,
  markRunning,
  markTerminal,
  quietLogger,
  readEvent,
  readExport,
  readBlobs,
  secondsFromDbNow,
  seedExportEvent,
  seedWorld,
  setAttempt,
  setNextAttemptMinutes,
  type World,
} from "./export-fixtures.ts";

const claim = (world: World, exportId: string, leaseOwner = "worker-a") =>
  fence().store.decideClaim({ clinicId: world.clinicId, exportId, leaseOwner });

describe("export claim decision", () => {
  it.each(["done", "expired", "purged"] as const)("closes %s without a write", async (status) => {
    const world = seedWorld();
    const exportId = insertExport(world);
    markTerminal(world.clinicId, exportId, status);
    await expect(claim(world, exportId)).resolves.toEqual({ kind: "dispatched" });
    expect(readExport(world.clinicId, exportId)?.attempt).toBe(0);
  });

  it("returns the persisted failure code and missing rows fail closed", async () => {
    const world = seedWorld();
    const exportId = insertExport(world);
    markTerminal(world.clinicId, exportId, "failed", "forbidden");
    await expect(claim(world, exportId)).resolves.toEqual({ kind: "failed", error: "forbidden" });
    await expect(claim(world, randomUUID())).resolves.toEqual({
      kind: "failed",
      error: "missing_export",
    });
    expect(readExport(world.clinicId, exportId)?.status).toBe("failed");
  });

  it("defers a live lease and a future queue without incrementing", async () => {
    const world = seedWorld();
    const live = insertExport(world);
    markRunning(world.clinicId, live, { attempt: 2, owner: "other", lease: "live" });
    const waiting = insertExport(world, { requestedBy: randomUUID() });
    setNextAttemptMinutes(world.clinicId, waiting, 10);
    const liveDecision = await claim(world, live);
    const waitDecision = await claim(world, waiting);
    expect(liveDecision.kind).toBe("deferred");
    expect(waitDecision.kind).toBe("deferred");
    expect(readExport(world.clinicId, live)).toMatchObject({
      status: "running",
      attempt: 2,
      lease_owner: "other",
    });
    expect(readExport(world.clinicId, waiting)).toMatchObject({ status: "queued", attempt: 0 });
  });

  it("leases a due row once, sets started_at once, and the handler builds nothing", async () => {
    const world = seedWorld();
    const exportId = insertExport(world);
    const seen: { clinicId: string; exportId: string; attempt: number; leaseOwner: string }[] = [];
    const handle = handleExportRequested({
      claims: fence().store,
      handoff: { record: (identity) => seen.push(identity) },
      leaseOwner: "worker-a",
      logger: quietLogger,
    });
    const outcome = await handle({
      id: randomUUID(),
      clinicId: world.clinicId,
      type: FINANCE_REPORT_EXPORT_REQUESTED,
      payload: { exportId },
      attempts: 4,
      createdAt: new Date(),
    });
    const row = readExport(world.clinicId, exportId);
    expect(outcome.kind).toBe("deferred");
    expect(row).toMatchObject({
      status: "running",
      attempt: 1,
      lease_owner: "worker-a",
      storage_key: null,
    });
    expect(row?.started_at).not.toBeNull();
    expect(secondsFromDbNow(row!.lease_until!)).toBeGreaterThan(50);
    expect(secondsFromDbNow(row!.lease_until!)).toBeLessThan(70);
    expect(readBlobs(world.clinicId, exportId)).toEqual([]);
    expect(seen).toEqual([
      { clinicId: world.clinicId, exportId, attempt: 1, leaseOwner: "worker-a" },
    ]);
    markRunning(world.clinicId, exportId, {
      attempt: 1,
      owner: "worker-a",
      lease: "expired",
      startedAt: row!.started_at!,
    });
    const takeover = await claim(world, exportId, "worker-c");
    expect(takeover.kind).toBe("leased");
    expect(readExport(world.clinicId, exportId)).toMatchObject({
      attempt: 2,
      lease_owner: "worker-c",
      started_at: row!.started_at,
    });
  });

  it("fails a queued or expired running row at the limit without incrementing", async () => {
    const world = seedWorld();
    const queued = insertExport(world);
    const running = insertExport(world, { requestedBy: randomUUID() });
    setAttempt(world.clinicId, queued, 5);
    markRunning(world.clinicId, running, { attempt: 5, owner: "dead", lease: "expired" });
    await expect(claim(world, queued)).resolves.toEqual({
      kind: "failed",
      error: "attempts_exhausted",
    });
    await expect(claim(world, running)).resolves.toEqual({
      kind: "failed",
      error: "attempts_exhausted",
    });
    expect(readExport(world.clinicId, queued)).toMatchObject({
      status: "failed",
      attempt: 5,
      error_code: "attempts_exhausted",
    });
    expect(readExport(world.clinicId, running)).toMatchObject({
      status: "failed",
      attempt: 5,
      lease_owner: null,
    });
  });

  it("lets one same-row claim lease and the other defer to that lease", async () => {
    const world = seedWorld();
    const exportId = insertExport(world);
    const [first, second] = await Promise.all([
      claim(world, exportId, "a"),
      claim(world, exportId, "b"),
    ]);
    const leased = [first, second].filter((item) => item.kind === "leased");
    const deferred = [first, second].filter((item) => item.kind === "deferred");
    expect(leased).toHaveLength(1);
    expect(deferred).toHaveLength(1);
    expect(readExport(world.clinicId, exportId)?.attempt).toBe(1);
  });

  it("lets one member race win and defers the other unchanged for 30 seconds", async () => {
    const world = seedWorld();
    const left = insertExport(world);
    const right = insertExport(world);
    const [first, second] = await Promise.all([claim(world, left, "a"), claim(world, right, "b")]);
    const deferred = [first, second].find((item) => item.kind === "deferred");
    const winner = readExport(world.clinicId, left)?.status === "running" ? left : right;
    const loser = winner === left ? right : left;
    expect(deferred?.kind).toBe("deferred");
    if (deferred?.kind === "deferred")
      expect(secondsFromDbNow(deferred.nextAttemptAt.toISOString())).toBeGreaterThan(20);
    if (deferred?.kind === "deferred")
      expect(secondsFromDbNow(deferred.nextAttemptAt.toISOString())).toBeLessThan(40);
    expect(readExport(world.clinicId, winner)).toMatchObject({ status: "running", attempt: 1 });
    expect(readExport(world.clinicId, loser)).toMatchObject({
      status: "queued",
      attempt: 0,
      lease_owner: null,
    });
  });

  it("rejects a malformed handler call without an export write", async () => {
    const world = seedWorld();
    const exportId = insertExport(world);
    const handle = handleExportRequested({
      claims: fence().store,
      handoff: {
        record() {
          throw new Error("handoff");
        },
      },
      leaseOwner: "worker-a",
      logger: quietLogger,
    });
    await expect(
      handle({
        id: randomUUID(),
        clinicId: null,
        type: FINANCE_REPORT_EXPORT_REQUESTED,
        payload: { exportId },
        attempts: 0,
        createdAt: new Date(),
      }),
    ).resolves.toEqual({ kind: "failed", error: "invalid_payload" });
    expect(readExport(world.clinicId, exportId)).toMatchObject({ status: "queued", attempt: 0 });
  });

  it("keeps an app lease when the dispatcher rolls back, and deferred does not count an attempt", async () => {
    const world = seedWorld();
    const exportId = insertExport(world);
    const controlId = seedExportEvent(world.clinicId, randomUUID(), "now");
    const eventId = seedExportEvent(world.clinicId, exportId);
    const before = readEvent(controlId);
    await expect(
      fence().outbox.claimNext([FINANCE_REPORT_EXPORT_REQUESTED], new Date(), async (event) => {
        expect(event.id).toBe(eventId);
        const decision = await claim(world, exportId);
        expect(decision.kind).toBe("leased");
        throw new Error("dispatcher rolled back");
      }),
    ).rejects.toThrow("dispatcher rolled back");
    expect(readExport(world.clinicId, exportId)).toMatchObject({ status: "running", attempt: 1 });
    expect(readEvent(eventId)).toMatchObject({
      attempts: 0,
      last_error: null,
      dispatched_at: null,
      failed_at: null,
    });
    const handle = handleExportRequested({
      claims: fence().store,
      handoff: { record() {} },
      leaseOwner: "worker-b",
      logger: quietLogger,
    });
    const claimed = await fence().outbox.claimNext(
      [FINANCE_REPORT_EXPORT_REQUESTED],
      new Date(),
      handle,
    );
    expect(claimed?.event.id).toBe(eventId);
    expect(claimed?.outcome.kind).toBe("deferred");
    expect(readEvent(controlId)).toEqual(before);
    expect(readEvent(eventId)).toMatchObject({
      attempts: 0,
      last_error: null,
      failed_at: null,
      dispatched_at: null,
    });
    expect(readEvent(eventId).next_attempt_at).not.toBeNull();
    expect(readExport(world.clinicId, exportId)?.attempt).toBe(1);
  });
});
