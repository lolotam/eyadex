import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, createDatabase, type Database } from "@eyadex/db";
import { REPORT_EXPORT_COLUMNS } from "@eyadex/contracts/finance-reports";
import type { ReportId } from "@eyadex/contracts/finance-reports";

import { PgExportReports } from "../persistence/pg-export-reports.ts";
import type { ExportCsvRow } from "../domain/export-cells.ts";
import { writeReportCsv } from "../domain/export-csv.ts";
import type { ExportFence, PreparedExportJob } from "../ports/export-store.ts";
import { seedMember, seedWorld, urls } from "./export-fixtures.ts";
import { reportData } from "./export-report-data.ts";
import { leaseExport, openMember } from "./export-prepare-fixtures.ts";
import { PgExportStore } from "../persistence/pg-export-store.ts";
import { ExportReadRefused } from "../domain/export-read-refused.ts";

const keys = [
  "view:report_takings:clinic",
  "view:report_analytics:clinic",
  "view:report_patients:clinic",
  "view:report_own:own",
  "view:invoices:clinic",
  "view:invoices:own",
  "view:payments:clinic",
  "view:cash_closings:clinic",
];

async function leased(world: ReturnType<typeof seedWorld>, job: PreparedExportJob) {
  const { exportId } = leaseExport(world, {
    report: job.report,
    scope: job.scope,
    branchIds: job.params.branchIds,
    ...(job.params.groupBy === undefined ? {} : { groupBy: job.params.groupBy }),
  });
  const fence = { clinicId: world.clinicId, exportId, attempt: 1, leaseOwner: "worker-a" };
  const store = new PgExportStore(db, { newId: randomUUID });
  const prepared = await store.prepareLeasedJob(fence);
  expect(prepared.kind).toBe("ready");
  expect((await store.allocateBlob(fence)).kind).toBe("allocated");
  return fence;
}

let db: Database;
let reader: ReturnType<typeof collectingReader>;
beforeAll(() => {
  db = createDatabase({ url: urls().app, role: "eyadex_app", ids: { newId: randomUUID } });
  reader = collectingReader(
    new PgExportReports(db, { now: () => new Date("2026-02-15T00:00:00Z") }, { newId: randomUUID }),
  );
});
afterAll(async () => db.close());

// Small fixture answers are collected here only; the production reader exposes no row/id arrays.
function collectingReader(production: PgExportReports) {
  return {
    async read(fence: ExportFence, job: PreparedExportJob, signal: AbortSignal) {
      const rows: ExportCsvRow[] = [];
      const result = await production.read(fence, job, signal, {
        async start() {},
        async write(row) {
          rows.push(row);
        },
        async finish() {},
      });
      const patientIds =
        result.patientSet === "ledger"
          ? await db.withTenant(fence.clinicId, async (tx) =>
              (
                await tx.execute<{
                  id: string;
                }>(sql`SELECT patient_id AS id FROM finance_report_export_patients
        WHERE clinic_id = ${fence.clinicId} AND export_id = ${fence.exportId} AND attempt = ${fence.attempt}
          AND patient_id IS NOT NULL ORDER BY patient_id`)
              ).map((row) => row.id),
            )
          : null;
      return { rows, patientIds };
    },
  };
}

describe("all finance export reads under RLS", () => {
  it.each(Object.keys(REPORT_EXPORT_COLUMNS) as ReportId[])(
    "runs %s without a screen pagination or a money write",
    async (report) => {
      const w = openMember(keys);
      const job: PreparedExportJob = {
        report,
        format: "csv",
        scope: report === "own_summary" ? "own" : "clinic",
        requestedBy: w.membershipId,
        userId: w.userId,
        params: {
          from: "2026-01-01",
          to: "2026-12-31",
          branchIds: [],
          language: "ar",
          ...(["daily_takings", "period_summary"].includes(report)
            ? { groupBy: "day" as const }
            : {}),
        },
      };
      const answer = await reader.read(await leased(w, job), job, new AbortController().signal);
      expect(answer.rows).toEqual([]);
      expect(answer.patientIds).toEqual(job.scope === "own" ? [] : null);
    },
  );

  it("R5 exports all eligible rows with guarded names, exact amounts and clinic-timezone age", async () => {
    const w = openMember(keys);
    const data = reportData(w);
    const job: PreparedExportJob = {
      report: "outstanding",
      format: "csv",
      scope: "clinic",
      requestedBy: w.membershipId,
      userId: w.userId,
      params: { from: "2026-01-01", to: "2026-12-31", branchIds: [data.branchId], language: "en" },
    };
    const fence = await leased(w, job);
    const result = await reader.read(fence, job, new AbortController().signal);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.["ageBucket"]).toEqual({ kind: "text", value: "31_60" });
    const csv = writeReportCsv({ report: job.report, language: "en", rows: result.rows });
    expect(csv.ok && csv.bytes.toString()).toContain("'=Synthetic patient,12.500,0.000,12.500");
    expect(
      (
        await reader.read(
          fence,
          { ...job, params: { ...job.params, branchIds: [] } },
          new AbortController().signal,
        )
      ).rows,
    ).toEqual(result.rows);
    const foreign = seedWorld();
    await expect(
      reader.read({ ...fence, clinicId: foreign.clinicId }, job, new AbortController().signal),
    ).rejects.toEqual(new ExportReadRefused("lost_lease"));
  });

  it("R10 uses both patient reach and line ownership, and collects only the file's patients", async () => {
    const w = openMember(keys);
    const data = reportData(w, true);
    reportData(seedWorld(), true);
    const job: PreparedExportJob = {
      report: "own_summary",
      format: "csv",
      scope: "own",
      requestedBy: w.membershipId,
      userId: w.userId,
      params: {
        from: "2026-01-01",
        to: "2026-12-31",
        branchIds: [data.branchId],
        language: "en",
      },
    };
    const fence = await leased(w, job);
    const result = await reader.read(fence, job, new AbortController().signal);
    expect(result.patientIds).toEqual([data.patientId]);
    expect(result.rows[0]?.["billedMinor"]).toEqual({ kind: "money", minor: "12500", exponent: 3 });
    expect(
      (
        await reader.read(
          fence,
          { ...job, requestedBy: randomUUID() },
          new AbortController().signal,
        )
      ).rows,
    ).toEqual(result.rows);
    const colleague = { ...w, ...seedMember(w) };
    const ownJob = { ...job, requestedBy: colleague.membershipId, userId: colleague.userId };
    const ownRows = await reader.read(
      await leased(colleague, ownJob),
      ownJob,
      new AbortController().signal,
    );
    expect(ownRows).toEqual({ rows: [], patientIds: [] });
  });
});
