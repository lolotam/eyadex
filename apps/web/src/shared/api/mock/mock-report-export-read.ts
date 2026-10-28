import {
  REPORT_EXPORT_COLUMNS,
  type ReportId,
  type FrozenReportExportParams,
} from "@eyadex/contracts/finance-reports";
import { currencyCodeSchema, SUPPORTED_CURRENCIES } from "@eyadex/contracts/money";
import { ApiError } from "../api-error";
import type { ExportCell, ExportCsvRow } from "./mock-export-cells";
import type { ReportContext } from "./mock-report-access";
import { byDoctor, byService, ownContributions, ownSummary } from "./mock-report-analytics";
import { outstanding, patientCredit } from "./mock-report-balances";
import { discounts, refunds } from "./mock-report-adjustments";
import { cashClosings, dailyTakings, periodSummary } from "./mock-report-takings";

type RawRow = Record<string, unknown>;
type PageQuery = { from: string; to: string; limit: number; cursor?: string };

function allPages<T>(
  read: (query: PageQuery) => { items: T[]; nextCursor: string | null },
  params: FrozenReportExportParams,
): T[] {
  const rows: T[] = [];
  let cursor: string | undefined;
  do {
    const page = read({
      from: params.from,
      to: params.to,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    });
    rows.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return rows;
}

function exportContext(current: ReportContext, params: FrozenReportExportParams): ReportContext {
  const branches = current.db.branches.filter((branch) => branch.clinicId === current.clinicId);
  if (
    params.branchIds.some(
      (id) => !current.branchIds.includes(id) || !branches.some((branch) => branch.id === id),
    )
  )
    throw new ApiError("forbidden");
  return {
    ...current,
    language: params.language,
    branchIds: [...params.branchIds],
    branchNames: new Map(
      branches.map((branch) => [
        branch.id,
        params.language === "ar" ? branch.nameAr : branch.nameEn,
      ]),
    ),
  };
}

function cells(report: ReportId, raw: RawRow, language: "ar" | "en"): ExportCsvRow {
  const currency = currencyCodeSchema.safeParse(raw["currency"]);
  if (!currency.success) throw new ApiError("export_value_invalid");
  const exponent = SUPPORTED_CURRENCIES[currency.data];
  const result: Record<string, ExportCell> = {};
  for (const column of REPORT_EXPORT_COLUMNS[report]) {
    const value = raw[column.key];
    if (column.kind === "money" && typeof value === "string")
      result[column.key] = { kind: "money", minor: value, exponent };
    else if (
      column.kind === "count" &&
      (typeof value === "number" || typeof value === "string" || typeof value === "bigint")
    )
      result[column.key] = { kind: "count", value };
    else if (column.kind === "date" && typeof value === "string")
      result[column.key] = { kind: "date", value };
    else if (column.kind === "text" && column.key === "notePresent" && typeof value === "boolean")
      result[column.key] = {
        kind: "text",
        value: value ? (language === "ar" ? "نعم" : "Yes") : language === "ar" ? "لا" : "No",
      };
    else if (column.kind === "text" && (typeof value === "string" || value === null))
      result[column.key] = { kind: "text", value };
    else throw new ApiError("export_value_invalid");
  }
  return result;
}

/** Internal only: the caller must authorize current access before invoking this reader. */
export function readReportExport(
  current: ReportContext,
  report: ReportId,
  params: FrozenReportExportParams,
  now: Date,
): {
  rows: ExportCsvRow[];
  ownPatientIds: readonly string[] | null;
} {
  const ctx = exportContext(current, params);
  let raw: RawRow[];
  switch (report) {
    case "daily_takings":
      raw = dailyTakings(ctx, { ...params, groupBy: params.groupBy ?? "day" }).rows;
      break;
    case "period_summary":
      raw = periodSummary(ctx, { ...params, groupBy: params.groupBy ?? "month" }).rows;
      break;
    case "by_service":
      raw = byService(ctx, params).rows;
      break;
    case "by_doctor":
      raw = byDoctor(ctx, params).rows;
      break;
    case "cash_closings":
      raw = cashClosings(ctx, params).rows;
      break;
    case "own_summary":
      raw = ownSummary(ctx, params).rows;
      break;
    case "outstanding":
      raw = allPages((q) => outstanding(ctx, q, now), params);
      break;
    case "patient_credit":
      raw = allPages((q) => patientCredit(ctx, q), params);
      break;
    case "refunds":
      raw = allPages((q) => refunds(ctx, q), params);
      break;
    case "discounts":
      raw = allPages((q) => discounts(ctx, q), params);
      break;
  }
  return {
    rows: raw.map((row) => cells(report, row, params.language)),
    ownPatientIds:
      report === "own_summary"
        ? [...new Set(ownContributions(ctx, params).map((line) => line.patientId))]
        : null,
  };
}
