import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DatabaseError } from "@eyadex/db";

import { fence } from "./export-fence-bind.ts";
import {
  insertBlob,
  insertExport,
  markRunning,
  markTerminal,
  owner,
  readAudits,
  readBlobs,
  readExport,
  secondsFromDbNow,
  seedMember,
  seedWorld,
  type World,
} from "./export-fixtures.ts";

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;
const owned = (world: World, exportId: string, attempt: number, leaseOwner = "worker-a") => ({
  clinicId: world.clinicId,
  exportId,
  attempt,
  leaseOwner,
});

function running(
  world: World,
  attempt = 1,
  lease: "live" | "expired" = "live",
  ownerName = "worker-a",
): string {
  const exportId = insertExport(world, { requestedBy: seedMember(world).membershipId });
  markRunning(world.clinicId, exportId, { attempt, owner: ownerName, lease });
  return exportId;
}

describe("export fence and publish", () => {
  it("renews a live heartbeat and leaves expired or final leases untouched", async () => {
    const world = seedWorld();
    const live = running(world);
    const expired = running(world, 1, "expired");
    const done = insertExport(world, { requestedBy: randomUUID() });
    markTerminal(world.clinicId, done, "done");
    owner(
      `UPDATE finance_report_exports SET lease_until = clock_timestamp() + interval '45 seconds', lease_owner = 'worker-a', attempt = 1 WHERE clinic_id = ${q(world.clinicId)} AND id = ${q(done)}`,
    );
    const renewed = await fence().store.heartbeat(owned(world, live, 1));
    expect(renewed).toEqual({ kind: "applied" });
    expect(secondsFromDbNow(readExport(world.clinicId, live)!.lease_until!)).toBeGreaterThan(50);
    const before = readExport(world.clinicId, expired)!.lease_until;
    expect(await fence().store.heartbeat(owned(world, expired, 1))).toEqual({ kind: "lost_lease" });
    expect(readExport(world.clinicId, expired)!.lease_until).toBe(before);
    const finalBefore = readExport(world.clinicId, done);
    expect(await fence().store.heartbeat(owned(world, done, 1))).toEqual({ kind: "lost_lease" });
    expect(readExport(world.clinicId, done)).toMatchObject({
      status: "done",
      lease_until: finalBefore?.lease_until,
    });
  });

  it("does not let failure, release or abandon overwrite a new owner", async () => {
    const world = seedWorld();
    for (const call of ["recordFailure", "release", "abandon"] as const) {
      const exportId = running(world, 2, "live", "winner");
      const stale = owned(world, exportId, 2, "loser");
      const result =
        call === "recordFailure"
          ? await fence().store.recordFailure(stale, "build_failed")
          : await fence().store[call](stale);
      expect(result).toEqual({ kind: "lost_lease" });
      expect(readExport(world.clinicId, exportId)).toMatchObject({
        status: "running",
        lease_owner: "winner",
        attempt: 2,
      });
    }
  });

  it.each([
    [1, 60],
    [2, 300],
    [3, 1800],
    [4, 7200],
  ] as const)("requeues attempt %s after %s seconds, not 360 minutes", async (attempt, seconds) => {
    const world = seedWorld();
    const exportId = running(world, attempt);
    expect(
      await fence().store.recordFailure(owned(world, exportId, attempt), "store_unavailable"),
    ).toEqual({ kind: "applied" });
    const row = readExport(world.clinicId, exportId);
    expect(row).toMatchObject({
      status: "queued",
      attempt,
      lease_owner: null,
      error_code: "store_unavailable",
    });
    expect(secondsFromDbNow(row!.next_attempt_at!)).toBeGreaterThan(seconds - 5);
    expect(secondsFromDbNow(row!.next_attempt_at!)).toBeLessThan(seconds + 15);
  });

  it("finalizes the fifth failure and leaves the fifth abandon queued for a terminal claim", async () => {
    const world = seedWorld();
    const failed = running(world, 5);
    expect(await fence().store.recordFailure(owned(world, failed, 5), "build_failed")).toEqual({
      kind: "applied",
    });
    expect(readExport(world.clinicId, failed)).toMatchObject({
      status: "failed",
      attempt: 5,
      error_code: "build_failed",
      lease_owner: null,
    });
    const left = running(world, 1);
    expect(await fence().store.recordFailure(owned(world, left, 1), "forbidden")).toEqual({
      kind: "applied",
    });
    expect(readExport(world.clinicId, left)?.status).toBe("failed");
    const abandoned = running(world, 5);
    expect(await fence().store.abandon(owned(world, abandoned, 5))).toEqual({ kind: "applied" });
    expect(readExport(world.clinicId, abandoned)).toMatchObject({
      status: "queued",
      attempt: 5,
      next_attempt_at: null,
    });
    await expect(
      fence().store.decideClaim({
        clinicId: world.clinicId,
        exportId: abandoned,
        leaseOwner: "next",
      }),
    ).resolves.toEqual({
      kind: "failed",
      error: "attempts_exhausted",
    });
    expect(readExport(world.clinicId, abandoned)?.attempt).toBe(5);
  });

  it("publishes once, stores own patients, nulls other scopes, and replays as own success", async () => {
    const world = seedWorld();
    const patients = [randomUUID(), randomUUID()];
    const ownId = insertExport(world, { scope: "own", report: "own_summary" });
    markRunning(world.clinicId, ownId, { attempt: 2, owner: "worker-a", lease: "live" });
    insertBlob(world.clinicId, ownId, 2, "uploaded", "csv");
    const published = await fence().store.publish(owned(world, ownId, 2), {
      byteSize: 12,
      rowCount: 2,
      patientIds: patients,
    });
    expect(published).toEqual({ kind: "published" });
    const row = readExport(world.clinicId, ownId);
    expect(row).toMatchObject({
      status: "done",
      storage_key: `clinic/${world.clinicId}/finance-exports/${ownId}/2.csv`,
      byte_size: 12,
      row_count: 2,
      patient_ids: patients,
      lease_owner: null,
    });
    expect(
      secondsFromDbNow(row!.expires_at!) - secondsFromDbNow(row!.finished_at!),
    ).toBeGreaterThan(86_390);
    expect(readBlobs(world.clinicId, ownId)).toMatchObject([{ state: "published" }]);
    const audit = readAudits(world.clinicId, ownId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "finance_report.exported",
      category: "administrative",
      actor_user_id: world.userId,
      branch_id: null,
    });
    expect(Object.keys(audit[0]!.details).sort()).toEqual([
      "branchIds",
      "from",
      "report",
      "rowCount",
      "to",
    ]);
    expect(
      await fence().store.publish(owned(world, ownId, 2), {
        byteSize: 12,
        rowCount: 2,
        patientIds: patients,
      }),
    ).toEqual({
      kind: "own_success",
    });
    expect(await fence().store.heartbeat(owned(world, ownId, 2))).toEqual({ kind: "own_success" });
    expect(readAudits(world.clinicId, ownId)).toHaveLength(1);
    expect(readExport(world.clinicId, ownId)?.storage_key).toBe(row?.storage_key);
    const named = insertExport(world, { report: "outstanding", format: "xlsx" });
    markRunning(world.clinicId, named, { attempt: 1, owner: "worker-a", lease: "live" });
    insertBlob(world.clinicId, named, 1, "uploaded", "xlsx");
    expect(
      await fence().store.publish(owned(world, named, 1), {
        byteSize: 8,
        rowCount: 1,
        patientIds: patients,
      }),
    ).toEqual({ kind: "published" });
    expect(readExport(world.clinicId, named)?.patient_ids).toBeNull();
    expect(readExport(world.clinicId, named)?.storage_key).toBe(
      `clinic/${world.clinicId}/finance-exports/${named}/1.xlsx`,
    );
    expect(readBlobs(world.clinicId, named)[0]?.storage_key).toBe(
      `clinic/${world.clinicId}/finance-exports/${named}/1.xlsx`,
    );
    expect(readAudits(world.clinicId, named)[0]?.category).toBe("patient_access");
  });

  it("refuses a stale owner, an expired lease, and a blob that is not uploaded, with no audit", async () => {
    const world = seedWorld();
    const stale = running(world, 3);
    insertBlob(world.clinicId, stale, 3, "uploaded", "csv");
    expect(
      await fence().store.publish(owned(world, stale, 2), {
        byteSize: 4,
        rowCount: 1,
        patientIds: null,
      }),
    ).toEqual({
      kind: "lost_lease",
    });
    expect(readExport(world.clinicId, stale)?.status).toBe("running");
    const expired = running(world, 1, "expired");
    insertBlob(world.clinicId, expired, 1, "uploaded", "csv");
    expect(
      await fence().store.publish(owned(world, expired, 1), {
        byteSize: 4,
        rowCount: 1,
        patientIds: null,
      }),
    ).toEqual({
      kind: "lost_lease",
    });
    expect(readBlobs(world.clinicId, expired)[0]?.state).toBe("uploaded");
    for (const state of ["allocated", "deleted"] as const) {
      const exportId = running(world, 1);
      if (state === "allocated") insertBlob(world.clinicId, exportId, 1, state, "csv");
      else insertBlob(world.clinicId, exportId, 1, state, "csv");
      expect(
        await fence().store.publish(owned(world, exportId, 1), {
          byteSize: 4,
          rowCount: 0,
          patientIds: null,
        }),
      ).toEqual({
        kind: "lost_lease",
      });
      expect(readExport(world.clinicId, exportId)?.status).toBe("running");
      expect(readAudits(world.clinicId, exportId)).toEqual([]);
      expect(readBlobs(world.clinicId, exportId)[0]?.state).toBe(state);
    }
    const missing = running(world);
    expect(
      await fence().store.publish(owned(world, missing, 1), {
        byteSize: 4,
        rowCount: 0,
        patientIds: null,
      }),
    ).toEqual({
      kind: "lost_lease",
    });
    expect(readAudits(world.clinicId, missing)).toEqual([]);
  });

  it("propagates a blob unique collision and refuses an own publish without patients", async () => {
    const world = seedWorld();
    const exportId = running(world);
    const first = await fence().store.allocateBlob(owned(world, exportId, 1));
    expect(first.kind).toBe("allocated");
    await expect(fence().store.allocateBlob(owned(world, exportId, 1))).rejects.toBeInstanceOf(
      DatabaseError,
    );
    expect(readBlobs(world.clinicId, exportId)).toHaveLength(1);
    const ownId = insertExport(world, { scope: "own", report: "own_summary" });
    markRunning(world.clinicId, ownId, { attempt: 1, owner: "worker-a", lease: "live" });
    insertBlob(world.clinicId, ownId, 1, "uploaded", "csv");
    expect(
      await fence().store.publish(owned(world, ownId, 1), {
        byteSize: 4,
        rowCount: 0,
        patientIds: null,
      }),
    ).toEqual({
      kind: "refused",
      reason: "missing_patient_set",
    });
    expect(readExport(world.clinicId, ownId)?.status).toBe("running");
  });
});
