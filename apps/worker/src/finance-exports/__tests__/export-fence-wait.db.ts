import { describe, expect, it } from "vitest";

import { fence } from "./export-fence-bind.ts";
import { holdLock, waitForUngranted } from "./export-lock.ts";
import {
  insertBlob,
  insertExport,
  markRunning,
  owner,
  readAudits,
  readBlobs,
  readExport,
  secondsFromDbNow,
  seedMember,
  seedWorld,
  setAttempt,
  type World,
} from "./export-fixtures.ts";

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;
const owned = (world: World, exportId: string, attempt: number, leaseOwner = "worker-a") => ({
  clinicId: world.clinicId,
  exportId,
  attempt,
  leaseOwner,
});

function running(world: World): string {
  const exportId = insertExport(world, { requestedBy: seedMember(world).membershipId });
  markRunning(world.clinicId, exportId, { attempt: 1, owner: "worker-a", lease: "live" });
  return exportId;
}

describe("export lease wait", () => {
  it("refuses publish and heartbeat when the lease expires while waiting on the row lock", async () => {
    const world = seedWorld();
    const exportId = running(world);
    const blobId = insertBlob(world.clinicId, exportId, 1, "uploaded", "csv");
    const blobHold = holdLock(
      `SELECT id FROM finance_report_export_blobs WHERE clinic_id = '${world.clinicId}' AND id = '${blobId}' FOR UPDATE`,
      6,
    );
    await blobHold.ready;
    owner(
      `UPDATE finance_report_exports SET lease_until = clock_timestamp() + interval '2 seconds' WHERE clinic_id = ${q(world.clinicId)} AND id = ${q(exportId)}`,
    );
    const published = await fence().store.publish(owned(world, exportId, 1), {
      byteSize: 9,
      rowCount: 1,
      patientIds: null,
    });
    await blobHold.done;
    expect(published).toEqual({ kind: "lost_lease" });
    expect(readExport(world.clinicId, exportId)?.status).toBe("running");
    expect(readBlobs(world.clinicId, exportId)[0]?.state).toBe("uploaded");
    expect(readAudits(world.clinicId, exportId)).toEqual([]);
    const beatId = running(world);
    const before = readExport(world.clinicId, beatId)!.lease_until;
    const beatHold = holdLock(
      `SELECT id FROM finance_report_exports WHERE clinic_id = '${world.clinicId}' AND id = '${beatId}' FOR UPDATE`,
      4,
      `UPDATE finance_report_exports SET lease_until = clock_timestamp() - interval '1 second' WHERE clinic_id = '${world.clinicId}' AND id = '${beatId}'`,
    );
    await beatHold.ready;
    const beat = fence().store.heartbeat(owned(world, beatId, 1));
    await beatHold.done;
    expect(await beat).toEqual({ kind: "lost_lease" });
    expect(readExport(world.clinicId, beatId)!.lease_until).not.toBe(before);
    expect(secondsFromDbNow(readExport(world.clinicId, beatId)!.lease_until!)).toBeLessThan(0);
  });

  it("leases attempt 4 into attempt 5 and stops there", async () => {
    const world = seedWorld();
    const exportId = insertExport(world);
    setAttempt(world.clinicId, exportId, 4);
    const leased = await fence().store.decideClaim({
      clinicId: world.clinicId,
      exportId,
      leaseOwner: "worker-a",
    });
    expect(leased.kind).toBe("leased");
    expect(readExport(world.clinicId, exportId)?.attempt).toBe(5);
  });

  it("does not allocate after an unchanged export lock outlives the lease", async () => {
    const world = seedWorld();
    const exportId = running(world);
    owner(
      `UPDATE finance_report_exports SET lease_until = clock_timestamp() + interval '3 seconds' WHERE clinic_id = ${q(world.clinicId)} AND id = ${q(exportId)}`,
    );
    const hold = holdLock(
      `SELECT id FROM finance_report_exports WHERE clinic_id = '${world.clinicId}' AND id = '${exportId}' FOR UPDATE`,
      6,
    );
    await hold.ready;
    expect(secondsFromDbNow(readExport(world.clinicId, exportId)!.lease_until!)).toBeGreaterThan(0);
    const pending = fence().store.allocateBlob(owned(world, exportId, 1));
    await waitForUngranted("finance_report_exports");
    expect(secondsFromDbNow(readExport(world.clinicId, exportId)!.lease_until!)).toBeGreaterThan(0);
    await expect(pending).resolves.toEqual({ kind: "lost_lease" });
    await hold.done;
    expect(readBlobs(world.clinicId, exportId)).toEqual([]);
    expect(secondsFromDbNow(readExport(world.clinicId, exportId)!.lease_until!)).toBeLessThan(0);
  });

  it("takes over expired running after an unchanged lock, and leases a queue that becomes due", async () => {
    const world = seedWorld();
    const expired = running(world);
    owner(
      `UPDATE finance_report_exports SET lease_until = clock_timestamp() + interval '3 seconds' WHERE clinic_id = ${q(world.clinicId)} AND id = ${q(expired)}`,
    );
    const rowHold = holdLock(
      `SELECT id FROM finance_report_exports WHERE clinic_id = '${world.clinicId}' AND id = '${expired}' FOR UPDATE`,
      6,
    );
    await rowHold.ready;
    expect(secondsFromDbNow(readExport(world.clinicId, expired)!.lease_until!)).toBeGreaterThan(0);
    const takeover = fence().store.decideClaim({
      clinicId: world.clinicId,
      exportId: expired,
      leaseOwner: "worker-b",
    });
    await waitForUngranted("finance_report_exports");
    await expect(takeover).resolves.toMatchObject({ kind: "leased", attempt: 2 });
    await rowHold.done;
    expect(readExport(world.clinicId, expired)).toMatchObject({
      status: "running",
      attempt: 2,
      lease_owner: "worker-b",
    });
    const queued = insertExport(world, { requestedBy: seedMember(world).membershipId });
    owner(
      `UPDATE finance_report_exports SET next_attempt_at = clock_timestamp() + interval '3 seconds' WHERE clinic_id = ${q(world.clinicId)} AND id = ${q(queued)}`,
    );
    const queueHold = holdLock(
      `SELECT id FROM finance_report_exports WHERE clinic_id = '${world.clinicId}' AND id = '${queued}' FOR UPDATE`,
      6,
    );
    await queueHold.ready;
    const due = fence().store.decideClaim({
      clinicId: world.clinicId,
      exportId: queued,
      leaseOwner: "worker-a",
    });
    await waitForUngranted("finance_report_exports");
    await expect(due).resolves.toMatchObject({ kind: "leased", attempt: 1 });
    await queueHold.done;
  });

  it("does not publish when the audit lock outlives the lease", async () => {
    const world = seedWorld();
    const exportId = running(world);
    insertBlob(world.clinicId, exportId, 1, "uploaded", "csv");
    const hold = holdLock("LOCK TABLE audit_log IN SHARE MODE", 6);
    await hold.ready;
    owner(
      `UPDATE finance_report_exports SET lease_until = clock_timestamp() + interval '2 seconds' WHERE clinic_id = ${q(world.clinicId)} AND id = ${q(exportId)}`,
    );
    expect(secondsFromDbNow(readExport(world.clinicId, exportId)!.lease_until!)).toBeGreaterThan(0);
    const pending = fence().store.publish(owned(world, exportId, 1), {
      byteSize: 12,
      rowCount: 1,
      patientIds: null,
    });
    await waitForUngranted("audit_log");
    expect(secondsFromDbNow(readExport(world.clinicId, exportId)!.lease_until!)).toBeGreaterThan(0);
    await expect(pending).resolves.toEqual({ kind: "lost_lease" });
    await hold.done;
    expect(readExport(world.clinicId, exportId)?.status).toBe("running");
    expect(readBlobs(world.clinicId, exportId)[0]?.state).toBe("uploaded");
    expect(readAudits(world.clinicId, exportId)).toEqual([]);
  });

  it("does not publish or replay an uploaded blob whose key disagrees with format", async () => {
    const world = seedWorld();
    const exportId = insertExport(world);
    markRunning(world.clinicId, exportId, { attempt: 1, owner: "worker-a", lease: "live" });
    insertBlob(world.clinicId, exportId, 1, "uploaded", "xlsx");
    const input = { byteSize: 12, rowCount: 1, patientIds: null };
    expect(await fence().store.publish(owned(world, exportId, 1), input)).toEqual({
      kind: "lost_lease",
    });
    expect(readExport(world.clinicId, exportId)).toMatchObject({
      status: "running",
      storage_key: null,
    });
    expect(readBlobs(world.clinicId, exportId)[0]?.storage_key).toContain(".xlsx");
    expect(readBlobs(world.clinicId, exportId)[0]?.state).toBe("uploaded");
    expect(readAudits(world.clinicId, exportId)).toEqual([]);
    expect(await fence().store.publish(owned(world, exportId, 1), input)).toEqual({
      kind: "lost_lease",
    });
  });
});
