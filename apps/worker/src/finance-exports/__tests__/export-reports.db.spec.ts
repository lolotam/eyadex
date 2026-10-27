import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "@eyadex/db";
import { REPORT_EXPORT_COLUMNS } from "@eyadex/contracts/finance-reports";
import type { ReportId } from "@eyadex/contracts/finance-reports";

import { PgExportReports } from "../persistence/pg-export-reports.ts";
import { writeReportCsv } from "../domain/export-csv.ts";
import type { PreparedExportJob } from "../ports/export-store.ts";
import { seedWorld, urls } from "./export-fixtures.ts";
import { reportData } from "./export-report-data.ts";

let db: Database;
let reader: PgExportReports;
beforeAll(() => {
  db = createDatabase({ url: urls().app, role: "eyadex_app", ids: { newId: randomUUID } });
  reader = new PgExportReports(db, { now: () => new Date("2026-02-15T00:00:00Z") });
});
afterAll(async () => db.close());

describe("all finance export reads under RLS", () => {
  it.each(Object.keys(REPORT_EXPORT_COLUMNS) as ReportId[])(
    "runs %s without a screen pagination or a money write",
    async (report) => {
      const w = seedWorld();
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
      const answer = await reader.read(
        { clinicId: w.clinicId, exportId: randomUUID(), attempt: 1, leaseOwner: "worker" },
        job,
        new AbortController().signal,
      );
      expect(answer.rows).toEqual([]);
      expect(answer.patientIds).toEqual(job.scope === "own" ? [] : null);
    },
  );

  it("R5 exports all eligible rows with guarded names, exact amounts and clinic-timezone age", async () => {
    const w = seedWorld();
    const data = reportData(w);
    const job: PreparedExportJob = {
      report: "outstanding",
      format: "csv",
      scope: "clinic",
      requestedBy: w.membershipId,
      userId: w.userId,
      params: { from: "2026-01-01", to: "2026-12-31", branchIds: [data.branchId], language: "en" },
    };
    const fence = {
      clinicId: w.clinicId,
      exportId: randomUUID(),
      attempt: 1,
      leaseOwner: "worker",
    };
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
    ).toEqual([]);
    const foreign = seedWorld();
    expect(
      (
        await reader.read(
          { ...fence, clinicId: foreign.clinicId },
          job,
          new AbortController().signal,
        )
      ).rows,
    ).toEqual([]);
  });

  it("R10 uses both patient reach and line ownership, and collects only the file's patients", async () => {
    const w = seedWorld();
    const data = reportData(w, true);
    const outside = reportData(seedWorld(), true);
    const job: PreparedExportJob = {
      report: "own_summary",
      format: "csv",
      scope: "own",
      requestedBy: w.membershipId,
      userId: w.userId,
      params: {
        from: "2026-01-01",
        to: "2026-12-31",
        branchIds: [data.branchId, outside.branchId],
        language: "en",
      },
    };
    const fence = {
      clinicId: w.clinicId,
      exportId: randomUUID(),
      attempt: 1,
      leaseOwner: "worker",
    };
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
    ).toEqual([]);
  });
});
