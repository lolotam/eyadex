import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "@eyadex/db";

import { PgExportStore } from "../persistence/pg-export-store.ts";
import {
  insertExport,
  markRunning,
  owner,
  readExport,
  secondsFromDbNow,
  seedWorld,
  urls,
} from "./export-fixtures.ts";
import { holdLock, waitForUngranted } from "./export-lock.ts";

let db: Database;
let store: PgExportStore;
beforeAll(() => {
  db = createDatabase({ url: urls().app, role: "eyadex_app", ids: { newId: randomUUID } });
  store = new PgExportStore(db, { newId: randomUUID });
});
afterAll(async () => db.close());

const failures = [
  [1, "build_failed"],
  [1, "forbidden"],
  [5, "build_failed"],
] as const;

function setup(attempt: number, lease: "live" | "expired") {
  const world = seedWorld();
  const exportId = insertExport(world);
  markRunning(world.clinicId, exportId, { attempt, owner: "worker-a", lease });
  return { clinicId: world.clinicId, exportId, attempt, leaseOwner: "worker-a" };
}

describe("failure writes require a live running lease", () => {
  it.each(failures)(
    "expired attempt %s cannot record %s before takeover",
    async (attempt, kind) => {
      const fence = setup(attempt, "expired");
      const before = readExport(fence.clinicId, fence.exportId);
      await expect(store.recordFailure(fence, kind)).resolves.toEqual({ kind: "lost_lease" });
      expect(readExport(fence.clinicId, fence.exportId)).toEqual(before);
      const claim = await store.decideClaim({ ...fence, leaseOwner: "worker-b" });
      expect(claim).toMatchObject(
        attempt === 5
          ? { kind: "failed", error: "attempts_exhausted" }
          : { kind: "leased", attempt: attempt + 1 },
      );
    },
  );

  it.each(failures)(
    "attempt %s cannot record %s after an unchanged row lock outlives its lease",
    async (attempt, kind) => {
      const fence = setup(attempt, "live");
      owner(`UPDATE finance_report_exports SET lease_until = clock_timestamp() + interval '3 seconds'
        WHERE clinic_id = '${fence.clinicId}' AND id = '${fence.exportId}'`);
      const before = readExport(fence.clinicId, fence.exportId);
      const hold = holdLock(
        `SELECT id FROM finance_report_exports WHERE clinic_id = '${fence.clinicId}'
          AND id = '${fence.exportId}' FOR UPDATE`,
        6,
      );
      try {
        await hold.ready;
        expect(secondsFromDbNow(before!.lease_until!)).toBeGreaterThan(0);
        const pending = store.recordFailure(fence, kind);
        await waitForUngranted("finance_report_exports");
        expect(secondsFromDbNow(before!.lease_until!)).toBeGreaterThan(0);
        await expect(pending).resolves.toEqual({ kind: "lost_lease" });
        await hold.done;
        expect(secondsFromDbNow(before!.lease_until!)).toBeLessThan(0);
        expect(readExport(fence.clinicId, fence.exportId)).toEqual(before);
      } finally {
        hold.stop();
        await hold.done.catch(() => undefined);
      }
    },
  );

  it.each(["forbidden", "build_failed"] as const)(
    "cannot record %s over a final row even with matching owner and a future timestamp",
    async (kind) => {
      const fence = setup(1, "live");
      owner(`UPDATE finance_report_exports SET status = 'done'
        WHERE clinic_id = '${fence.clinicId}' AND id = '${fence.exportId}'`);
      const before = readExport(fence.clinicId, fence.exportId);
      await expect(store.recordFailure(fence, kind)).resolves.toEqual({ kind: "lost_lease" });
      expect(readExport(fence.clinicId, fence.exportId)).toEqual(before);
    },
  );
});
