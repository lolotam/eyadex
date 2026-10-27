import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, sql, type Database } from "@eyadex/db";
import type { ExportCsvRow } from "../domain/export-cells.ts";
import { PgExportReports } from "../persistence/pg-export-reports.ts";
import { PgExportStore } from "../persistence/pg-export-store.ts";
import { owner, urls } from "./export-fixtures.ts";
import { leaseExport, openMember, revoke } from "./export-prepare-fixtures.ts";
import { reportData } from "./export-report-data.ts";

let db: Database;
let store: PgExportStore;
let reader: PgExportReports;
const ids = { newId: randomUUID };
beforeAll(() => {
  db = createDatabase({ url: urls().app, role: "eyadex_app", ids });
  store = new PgExportStore(db, ids);
  reader = new PgExportReports(db, { now: () => new Date("2026-02-15T00:00:00Z") }, ids);
});
afterAll(async () => db.close());

async function setup(many = false) {
  const world = openMember([
    "view:report_own:own",
    "view:invoices:own",
    "view:invoices:clinic",
    "view:report_patients:clinic",
  ]);
  const data = reportData(world, true);
  if (many)
    owner(`INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender,
    registration_branch_id, status, created_at, updated_at)
    SELECT '${world.clinicId}', gen_random_uuid(), (n+1)::text, 'Sample bounded rows', gen_random_uuid()::text,
      '2000-01-01', 'female', '${data.branchId}', 'active', clock_timestamp(), clock_timestamp() FROM generate_series(1,1000) n;
    INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source,
      issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp, tax_minor,
      total_minor, created_by, created_at, updated_at)
    SELECT clinic_id, gen_random_uuid(), registration_branch_id, id, 2026, file_number::int,
      'STREAM-' || file_number, 'issued', 'manual', '2026-01-12T09:00:00Z', 'KWD', 3, 1, 0, 0, 0, 1,
      '${world.userId}', clock_timestamp(), clock_timestamp() FROM patients WHERE clinic_id = '${world.clinicId}' AND full_name = 'Sample bounded rows';
    INSERT INTO invoice_lines (clinic_id, id, invoice_id, position, kind, provider_id, description_ar,
      description_en, quantity, unit_price_minor, line_total_minor, created_at, updated_at)
    SELECT clinic_id, gen_random_uuid(), id, 0, 'free', '${world.membershipId}', 'Sample', 'Sample', 1, 1, 1,
      clock_timestamp(), clock_timestamp() FROM invoices WHERE clinic_id = '${world.clinicId}' AND number LIKE 'STREAM-%';
    INSERT INTO visits (clinic_id, id, branch_id, patient_id, provider_membership_id, status, started_at, created_at, updated_at)
    SELECT clinic_id, gen_random_uuid(), registration_branch_id, id, '${world.membershipId}', 'draft',
      clock_timestamp(), clock_timestamp(), clock_timestamp() FROM patients WHERE clinic_id = '${world.clinicId}' AND full_name = 'Sample bounded rows';`);
  const { exportId } = leaseExport(world, {
    report: "own_summary",
    scope: "own",
    branchIds: [data.branchId],
  });
  const fence = { clinicId: world.clinicId, exportId, attempt: 1, leaseOwner: "worker-a" };
  const prepared = await store.prepareLeasedJob(fence);
  if (prepared.kind !== "ready") throw new Error("fixture not ready");
  await store.allocateBlob(fence);
  return { ...world, ...data, fence, job: prepared.job };
}

function barrier() {
  let reached = () => {};
  let resume = () => {};
  const ready = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    resume = resolve;
  });
  return { reached, resume, ready, waiting };
}

describe("bounded report snapshot and own bookkeeping", () => {
  it("captures 1001 patients without an aggregate array and renews while the read transaction is still open", async () => {
    const t = await setup(true);
    const gate = barrier();
    const rows: ExportCsvRow[] = [];
    const building = reader.read(t.fence, t.job, new AbortController().signal, {
      async start() {},
      async write(row) {
        rows.push(row);
      },
      async finish() {
        gate.reached();
        await gate.waiting;
      },
    });
    await Promise.race([
      gate.ready,
      building.then(() => {
        throw new Error("reader finished before barrier");
      }),
    ]);
    const heartbeat = store.heartbeat(t.fence);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      expect(
        await Promise.race([
          heartbeat,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("read blocked heartbeat")), 1000);
          }),
        ]),
      ).toEqual({ kind: "applied" });
    } finally {
      clearTimeout(timer);
      gate.resume();
      await heartbeat;
    }
    expect(await building).toEqual({ patientSet: "ledger" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["billedMinor"]).toMatchObject({ kind: "money", minor: "13500" });
    const counts = await db.withTenant(t.clinicId, (tx) =>
      tx.execute<{ patients: number; complete: number }>(sql`SELECT
      count(patient_id)::int AS patients, count(*) FILTER (WHERE is_complete)::int AS complete
      FROM finance_report_export_patients WHERE clinic_id = ${t.clinicId} AND export_id = ${t.fence.exportId}`),
    );
    expect(counts[0]).toEqual({ patients: 1001, complete: 1 });
    await store.markUploaded(t.fence);
    expect(
      await store.publish(t.fence, {
        byteSize: 100,
        rowCount: 1,
        patientIds: [],
        patientSet: "ledger",
      }),
    ).toEqual({ kind: "published" });
  }, 60_000);

  it("rolls back patient capture and its completion marker when own reach is lost during writer finalization", async () => {
    const t = await setup();
    const gate = barrier();
    const building = reader.read(t.fence, t.job, new AbortController().signal, {
      async start() {},
      async write() {},
      async finish() {
        gate.reached();
        await gate.waiting;
      },
    });
    const rejected = expect(building).rejects.toMatchObject({ reason: "forbidden" });
    await Promise.race([
      gate.ready,
      building.then(() => {
        throw new Error("reader finished before barrier");
      }),
    ]);
    try {
      owner(`DELETE FROM visits WHERE clinic_id = '${t.clinicId}' AND id = '${t.visitId}'`);
    } finally {
      gate.resume();
    }
    await rejected;
    expect(
      await db.withTenant(t.clinicId, (tx) =>
        tx.execute(sql`SELECT id FROM finance_report_export_patients
      WHERE clinic_id = ${t.clinicId} AND export_id = ${t.fence.exportId}`),
      ),
    ).toEqual([]);
  }, 60_000);

  it("refuses publishing a captured own set after a patient leaves reach during upload", async () => {
    const t = await setup();
    await reader.read(t.fence, t.job, new AbortController().signal, {
      async start() {},
      async write() {},
      async finish() {},
    });
    owner(`DELETE FROM visits WHERE clinic_id = '${t.clinicId}' AND id = '${t.visitId}'`);
    await store.markUploaded(t.fence);
    expect(
      await store.publish(t.fence, {
        byteSize: 100,
        rowCount: 1,
        patientIds: [],
        patientSet: "ledger",
      }),
    ).toMatchObject({ kind: "refused" });
  }, 60_000);

  it("rejects a report grant revoked during finalization before committing the patient set", async () => {
    const t = await setup();
    const gate = barrier();
    const building = reader.read(t.fence, t.job, new AbortController().signal, {
      async start() {},
      async write() {},
      async finish() {
        gate.reached();
        await gate.waiting;
      },
    });
    const rejected = expect(building).rejects.toMatchObject({ reason: "forbidden" });
    await Promise.race([
      gate.ready,
      building.then(() => {
        throw new Error("reader finished before barrier");
      }),
    ]);
    try {
      revoke(t.clinicId, t.roleId, "view:report_own:own");
    } finally {
      gate.resume();
    }
    await rejected;
    expect(
      await db.withTenant(t.clinicId, (tx) =>
        tx.execute(sql`SELECT id FROM finance_report_export_patients
      WHERE clinic_id = ${t.clinicId} AND export_id = ${t.fence.exportId}`),
      ),
    ).toEqual([]);
  }, 60_000);
});
