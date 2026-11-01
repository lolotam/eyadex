import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DatabaseError, sql } from "@eyadex/db";

import { fence } from "./export-fence-bind.ts";
import { insertBlob, insertExport, readBlobs, seedWorld } from "./export-fixtures.ts";

const idsOf = (rows: unknown): string[] => (rows as { id: string }[]).map((row) => row.id);

async function expectRlsRefusal(write: Promise<unknown>): Promise<void> {
  const error = await write.then(
    () => {
      throw new Error("cross-clinic write was accepted");
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DatabaseError);
  expect((error as DatabaseError).code).toBe("42501");
}

describe("export tenant isolation", () => {
  it("shows the seeded blob only to its clinic and refuses cross-clinic writes with 42501", async () => {
    const world = seedWorld();
    const exportId = insertExport(world);
    const blobId = insertBlob(world.clinicId, exportId, 1, "allocated", "csv");
    const ownExport = await fence().app.withTenant(world.clinicId, (tx) =>
      tx.execute(sql`SELECT id FROM finance_report_exports WHERE id = ${exportId}`),
    );
    const ownBlob = await fence().app.withTenant(world.clinicId, (tx) =>
      tx.execute(sql`SELECT id FROM finance_report_export_blobs WHERE id = ${blobId}`),
    );
    expect(idsOf(ownExport)).toEqual([exportId]);
    expect(idsOf(ownBlob)).toEqual([blobId]);
    const hiddenExport = await fence().app.withTenant(world.otherClinicId, (tx) =>
      tx.execute(sql`SELECT id FROM finance_report_exports WHERE id = ${exportId}`),
    );
    const noneExport = await fence().app.withNoTenant((tx) =>
      tx.execute(sql`SELECT id FROM finance_report_exports WHERE id = ${exportId}`),
    );
    const hiddenBlob = await fence().app.withTenant(world.otherClinicId, (tx) =>
      tx.execute(sql`SELECT id FROM finance_report_export_blobs WHERE id = ${blobId}`),
    );
    const noneBlob = await fence().app.withNoTenant((tx) =>
      tx.execute(sql`SELECT id FROM finance_report_export_blobs WHERE id = ${blobId}`),
    );
    expect(idsOf(hiddenExport)).toEqual([]);
    expect(idsOf(noneExport)).toEqual([]);
    expect(idsOf(hiddenBlob)).toEqual([]);
    expect(idsOf(noneBlob)).toEqual([]);
    const otherExportId = randomUUID();
    await expectRlsRefusal(
      fence().app.withTenant(world.otherClinicId, (tx) =>
        tx.execute(sql`INSERT INTO finance_report_exports (clinic_id, id, requested_by, report, params, format, scope,
              status, attempt, created_at)
            VALUES (${world.clinicId}, ${otherExportId}, ${world.membershipId}, 'daily_takings', '{}'::jsonb, 'csv',
              'clinic', 'queued', 0, clock_timestamp())`),
      ),
    );
    const otherBlobId = randomUUID();
    const otherKey = `clinic/${world.clinicId}/finance-exports/${exportId}/2.csv`;
    await expectRlsRefusal(
      fence().app.withTenant(world.otherClinicId, (tx) =>
        tx.execute(sql`INSERT INTO finance_report_export_blobs (clinic_id, id, export_id, attempt, storage_key,
              state, deleted_at, created_at, updated_at)
            VALUES (${world.clinicId}, ${otherBlobId}, ${exportId}, 2, ${otherKey}, 'allocated', NULL,
              clock_timestamp(), clock_timestamp())`),
      ),
    );
    expect(readBlobs(world.clinicId, exportId)).toEqual([
      {
        id: blobId,
        attempt: 1,
        state: "allocated",
        storage_key: `clinic/${world.clinicId}/finance-exports/${exportId}/1.csv`,
      },
    ]);
  });
});
