import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DatabaseError, sql, type Database } from "@eyadex/db";

import type { PgExportStore } from "../persistence/pg-export-store.ts";
import {
  insertBlob,
  insertExport,
  markRunning,
  owner,
  ownerJson,
  readAudits,
  readBlobs,
  readEvent,
  readExport,
  secondsFromDbNow,
  seedExportEvent,
  seedMember,
  seedWorld,
} from "./export-fixtures.ts";
import { holdLock, waitForUngranted } from "./export-lock.ts";

export interface JobContext {
  readonly app: Database;
  readonly platform: PgExportStore;
  readonly store: PgExportStore;
  readonly platformDb: Database;
}

export interface JobFence {
  clinicId: string;
  exportId: string;
  attempt: number;
  leaseOwner: string;
}

let current: JobContext | undefined;

export function bindJob(context: JobContext): void {
  current = context;
}

export async function closeJob(): Promise<void> {
  if (current === undefined) return;
  const closing = current;
  current = undefined;
  await Promise.all([closing.app.close(), closing.platformDb.close()]);
}

export function jobDb(): JobContext {
  if (current === undefined) throw new Error("export job context is not bound");
  return current;
}

export function fenceOf(
  clinicId: string,
  exportId: string,
  attempt = 1,
  leaseOwner = "worker-a",
): JobFence {
  return { clinicId, exportId, attempt, leaseOwner };
}

export function rowJson(clinicId: string, exportId: string): unknown {
  return ownerJson<unknown[]>(
    `SELECT to_jsonb(e) AS row FROM finance_report_exports e WHERE clinic_id = '${clinicId}' AND id = '${exportId}'`,
  );
}

function appWaiter(): string {
  return owner(
    `SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND usename = 'eyadex_app' AND wait_event_type = 'Lock' AND query LIKE '%requested_by%'`,
  );
}

describe("leased export job fence", () => {
  it("returns null when an unchanged row lock outlasts the live lease", async () => {
    const world = seedWorld();
    const exportId = insertExport(world, { requestedBy: seedMember(world).membershipId });
    markRunning(world.clinicId, exportId, { attempt: 1, owner: "worker-a", lease: "live" });
    owner(
      `UPDATE finance_report_exports SET lease_until = clock_timestamp() + interval '3 seconds' WHERE clinic_id = '${world.clinicId}' AND id = '${exportId}'`,
    );
    const before = rowJson(world.clinicId, exportId);
    const hold = holdLock(
      `SELECT id FROM finance_report_exports WHERE clinic_id = '${world.clinicId}' AND id = '${exportId}' FOR UPDATE`,
      6,
    );
    try {
      await hold.ready;
      expect(secondsFromDbNow(readExport(world.clinicId, exportId)!.lease_until!)).toBeGreaterThan(
        0,
      );
      const pending = jobDb().store.readLeasedJob(fenceOf(world.clinicId, exportId));
      await waitForUngranted("finance_report_exports");
      expect(secondsFromDbNow(readExport(world.clinicId, exportId)!.lease_until!)).toBeGreaterThan(
        0,
      );
      expect(appWaiter()).toBe("1");
      await expect(pending).resolves.toBeNull();
      await hold.done;
      expect(secondsFromDbNow(readExport(world.clinicId, exportId)!.lease_until!)).toBeLessThan(0);
      expect(rowJson(world.clinicId, exportId)).toEqual(before);
    } finally {
      hold.stop();
      await hold.done.catch(() => undefined);
    }
  });

  it("hides another clinic, an empty context, and the platform role", async () => {
    const { app, store, platform } = jobDb();
    const world = seedWorld();
    const member = seedMember(world);
    const marker = "job-meta-7f3a";
    const params = {
      from: "2026-05-01",
      to: "2026-05-31",
      language: "en",
      branchIds: [randomUUID()],
      groupBy: "day",
      marker,
    };
    const exportId = insertExport(world, {
      requestedBy: member.membershipId,
      format: "csv",
      scope: "branch",
      report: "period_summary",
      params: JSON.stringify(params),
    });
    markRunning(world.clinicId, exportId, { attempt: 2, owner: "worker-a", lease: "live" });
    const blobId = insertBlob(world.clinicId, exportId, 2, "allocated", "csv");
    const eventId = seedExportEvent(world.clinicId, exportId);
    owner(
      `INSERT INTO audit_log (clinic_id, id, actor_user_id, action, category, entity_type, entity_id, branch_id, details, created_at)
       VALUES ('${world.clinicId}', '${randomUUID()}', '${world.userId}', 'finance_report.exported', 'administrative',
         'finance_report_export', '${exportId}', NULL, '{"report":"period_summary"}'::jsonb, clock_timestamp())`,
    );
    const before = rowJson(world.clinicId, exportId);
    const blobs = readBlobs(world.clinicId, exportId);
    const audits = readAudits(world.clinicId, exportId);
    const event = readEvent(eventId);
    const own = await store.readLeasedJob(fenceOf(world.clinicId, exportId, 2));
    expect(own).toEqual({
      requestedBy: member.membershipId,
      report: "period_summary",
      format: "csv",
      scope: "branch",
      params,
    });
    expect(await store.readLeasedJob(fenceOf(world.otherClinicId, exportId, 2))).toBeNull();
    const none = await app.withNoTenant((tx) =>
      tx.execute(sql`SELECT id FROM finance_report_exports WHERE id = ${exportId}`),
    );
    expect(none).toEqual([]);
    const refused = await platform.readLeasedJob(fenceOf(world.clinicId, exportId, 2)).then(
      () => {
        throw new Error("platform read was accepted");
      },
      (caught: unknown) => caught,
    );
    expect(refused).toBeInstanceOf(DatabaseError);
    expect((refused as DatabaseError).code).toBe("42501");
    expect(JSON.stringify(refused)).not.toContain(marker);
    expect(JSON.stringify(refused)).not.toContain(member.membershipId);
    expect(rowJson(world.clinicId, exportId)).toEqual(before);
    expect(readBlobs(world.clinicId, exportId)).toEqual(blobs);
    expect(readAudits(world.clinicId, exportId)).toEqual(audits);
    expect(readEvent(eventId)).toEqual(event);
    expect(blobs).toEqual([
      {
        id: blobId,
        attempt: 2,
        state: "allocated",
        storage_key: `clinic/${world.clinicId}/finance-exports/${exportId}/2.csv`,
      },
    ]);
    expect(audits).toHaveLength(1);
  });
});
