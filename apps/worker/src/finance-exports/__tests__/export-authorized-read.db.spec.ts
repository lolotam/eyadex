import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDatabase, sql, type Database, type Tx } from "@eyadex/db";

import { ExportReadRefused } from "../domain/export-read-refused.ts";
import { readAuthorizedExport } from "../persistence/pg-export-authorized-read.ts";
import { prepareLeasedExportJob } from "../persistence/pg-export-prepare.ts";
import { urls } from "./export-fixtures.ts";
import { leaseExport, openMember, revoke } from "./export-prepare-fixtures.ts";

let db: Database;
beforeAll(() => {
  db = createDatabase({ url: urls().app, role: "eyadex_app", ids: { newId: randomUUID } });
});
afterAll(async () => db.close());

function setup() {
  const world = openMember(["view:report_takings:clinic", "view:payments:clinic"]);
  const { exportId } = leaseExport(world, {
    report: "daily_takings",
    scope: "clinic",
    branchIds: [],
    groupBy: "day",
  });
  return {
    ...world,
    fence: { clinicId: world.clinicId, exportId, attempt: 1, leaseOwner: "worker-a" },
  };
}

it("a ready preflight cannot authorize a report after its covering key is revoked", async () => {
  const t = setup();
  expect((await prepareLeasedExportJob(db, t.fence)).kind).toBe("ready");
  revoke(t.clinicId, t.roleId, "view:payments:clinic");
  const read = vi.fn();
  await expect(readAuthorizedExport(db, t.fence, read)).rejects.toEqual(
    new ExportReadRefused("forbidden"),
  );
  expect(read).not.toHaveBeenCalled();
});

it("does not return report data when revocation commits during the SQL read", async () => {
  const t = setup();
  const read = vi.fn(async (tx: Tx) => {
    const rows = await tx.execute(sql`SELECT id FROM clinics WHERE id = ${t.clinicId}`);
    revoke(t.clinicId, t.roleId, "view:report_takings:clinic");
    return rows;
  });
  await expect(readAuthorizedExport(db, t.fence, read)).rejects.toEqual(
    new ExportReadRefused("forbidden"),
  );
  expect(read).toHaveBeenCalledOnce();
});

it("reads with the persisted job only while the fence and current access hold", async () => {
  const t = setup();
  await expect(
    readAuthorizedExport(db, t.fence, async (tx, job) => ({
      job,
      rows: await tx.execute<{ id: string }>(sql`SELECT id FROM clinics`),
    })),
  ).resolves.toMatchObject({
    job: { requestedBy: t.membershipId, scope: "clinic", report: "daily_takings" },
    rows: [{ id: t.clinicId }],
  });
  const read = vi.fn();
  await expect(
    readAuthorizedExport(db, { ...t.fence, clinicId: t.otherClinicId }, read),
  ).rejects.toEqual(new ExportReadRefused("lost_lease"));
  expect(read).not.toHaveBeenCalled();
});
