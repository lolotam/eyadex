import { sql, type Database, type Tx } from "@eyadex/db";
import { REPORT_EXPORT_COLUMNS, type ReportId } from "@eyadex/contracts/finance-reports";
import { currencyCodeSchema, SUPPORTED_CURRENCIES } from "@eyadex/contracts/money";

import type { ExportCell, ExportCsvRow } from "../domain/export-cells.ts";
import type { ExportReportReader } from "../ports/export-builder.ts";
import type { ExportFence, PreparedExportJob } from "../ports/export-store.ts";
import { exportReportQuery } from "./export-report-queries.ts";
import { readAuthorizedExport } from "./pg-export-authorized-read.ts";

type Raw = Record<string, unknown>;
type Clock = { now(): Date };

/** Reads all rows under forced RLS. Patient ids come from the same own aggregation as the file. */
export class PgExportReports implements ExportReportReader {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  /** @inheritdoc */
  async read(fence: ExportFence, _preflight: PreparedExportJob, signal: AbortSignal) {
    const startedAt = this.clock.now();
    return readAuthorizedExport(this.db, fence, async (tx, job) => {
      signal.throwIfAborted();
      const clinic = await tx.execute<{ today: string }>(sql`SELECT
        (${startedAt.toISOString()}::timestamptz AT TIME ZONE timezone)::date::text AS today
        FROM clinics WHERE id = ${fence.clinicId}`);
      if (clinic[0] === undefined) throw new Error("export_clinic_missing");
      const raw = await tx.execute<Raw>(exportReportQuery(fence.clinicId, job, clinic[0].today));
      signal.throwIfAborted();
      const named = await withNames(tx, fence.clinicId, job, raw);
      signal.throwIfAborted();
      const patientIds = job.scope === "own" ? [...new Set(raw.flatMap(readPatientIds))] : null;
      return { rows: named.map((row) => cells(job.report, row)), patientIds };
    });
  }
}

function readPatientIds(row: Raw): string[] {
  const value = row["patientIds"];
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
    throw new Error("export_patient_set_missing");
  }
  return value as string[];
}

async function withNames(tx: Tx, clinicId: string, job: PreparedExportJob, rows: readonly Raw[]) {
  const ar = job.params.language === "ar";
  const ids = (keys: readonly string[]) => [
    ...new Set(
      rows.flatMap((row) =>
        keys.flatMap((key) => (typeof row[key] === "string" ? [row[key] as string] : [])),
      ),
    ),
  ];
  const branches = await nameMap(tx, "branches", clinicId, ids(["branchId"]), ar);
  const patients = await nameMap(tx, "patients", clinicId, ids(["patientId"]), ar);
  const staff = await nameMap(
    tx,
    "memberships",
    clinicId,
    ids(["providerId", "closedBy", "refundedBy", "discountedBy"]),
    ar,
  );
  const services = await nameMap(tx, "clinic_services", clinicId, ids(["serviceId"]), ar);
  return rows.map((row) => ({
    ...row,
    branchName: branches.get(String(row["branchId"])) ?? "—",
    patientName: patients.get(String(row["patientId"])) ?? null,
    closedByName: staff.get(String(row["closedBy"])) ?? null,
    refundedByName: staff.get(String(row["refundedBy"])) ?? null,
    discountedByName: staff.get(String(row["discountedBy"])) ?? null,
    name:
      row["kind"] === "tax"
        ? ar
          ? "الضريبة"
          : "Tax"
        : row["kind"] === "free"
          ? ar
            ? "بنود حرة"
            : "Free lines"
          : row["kind"] === "none"
            ? ar
              ? "بدون دكتور"
              : "No doctor"
            : job.report === "by_service"
              ? (services.get(String(row["serviceId"])) ?? "—")
              : (staff.get(String(row["providerId"])) ?? "—"),
    notePresent: row["notePresent"] === true ? (ar ? "نعم" : "Yes") : ar ? "لا" : "No",
  }));
}

async function nameMap(
  tx: Tx,
  table: "branches" | "patients" | "memberships" | "clinic_services",
  clinicId: string,
  ids: readonly string[],
  ar: boolean,
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const column =
    table === "patients" || table === "memberships" ? "full_name" : ar ? "name_ar" : "name_en";
  const rows = await tx.execute<{
    id: string;
    name: string;
  }>(sql`SELECT id, ${sql.identifier(column)} AS name
    FROM ${sql.identifier(table)} WHERE clinic_id = ${clinicId}
      AND id = ANY(string_to_array(${ids.join(",")}, ',')::uuid[])`);
  return new Map(rows.map((row) => [row.id, row.name]));
}

function cells(report: ReportId, row: Raw): ExportCsvRow {
  const exponent = SUPPORTED_CURRENCIES[currencyCodeSchema.parse(row["currency"])];
  return Object.fromEntries(
    REPORT_EXPORT_COLUMNS[report].map((column) => {
      const value = row[column.key];
      let cell: ExportCell;
      if (column.kind === "money") {
        if (typeof value !== "string") throw new Error("export_amount_invalid");
        cell = { kind: "money", minor: value, exponent };
      } else if (column.kind === "count") {
        if (typeof value !== "string" && typeof value !== "number")
          throw new Error("export_count_invalid");
        cell = { kind: "count", value };
      } else if (column.kind === "date") {
        if (typeof value !== "string") throw new Error("export_date_invalid");
        cell = { kind: "date", value };
      } else {
        if (typeof value !== "string" && value !== null) throw new Error("export_text_invalid");
        cell = { kind: "text", value };
      }
      return [column.key, cell];
    }),
  );
}
