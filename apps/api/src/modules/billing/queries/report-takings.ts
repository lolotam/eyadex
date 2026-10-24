import type * as reports from "@eyadex/contracts/finance-reports";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";
import type { z } from "zod";

import { sumReportMoney } from "../domain/report-totals.ts";
import type { BillingReportStaff } from "../ports/billing-report-staff.ts";
import {
  branchReportItems,
  uuidArray,
  type ReportContext,
  type ReportQuery,
} from "./report-sql.ts";

type TakingsRow = Omit<z.infer<typeof reports.reportDailyTakingsRowSchema>, "branchName">;
type SummaryRow = Omit<z.infer<typeof reports.reportPeriodSummaryRowSchema>, "branchName">;
type ClosingRow = Omit<z.infer<typeof reports.reportCashClosingRowSchema>, "branchName">;
type Grouped = ReportQuery & { groupBy: "day" | "month" };

export async function dailyTakings(tx: Tx, ctx: ReportContext, query: Grouped) {
  const period = query.groupBy === "month" ? "YYYY-MM" : "YYYY-MM-DD";
  const rows = await tx.execute<TakingsRow>(sql`
    SELECT to_char(r.business_date, ${period}) AS period, r.branch_id AS "branchId",
      r.method, r.currency,
      sum(r.in_minor)::text AS "inMinor", sum(r.out_minor)::text AS "outMinor",
      sum(r.net_minor)::text AS "netMinor"
    FROM finance_report_daily_takings(${query.from}::date, ${query.to}::date,
      ${uuidArray(ctx.branchIds)}) r
    GROUP BY 1, 2, r.method, r.currency ORDER BY 1, 2, r.method`);
  return {
    rows: branchReportItems(ctx, rows),
    totals: {
      inMinor: sumReportMoney(rows, "inMinor"),
      outMinor: sumReportMoney(rows, "outMinor"),
      netMinor: sumReportMoney(rows, "netMinor"),
    },
  };
}

export async function periodSummary(tx: Tx, ctx: ReportContext, query: Grouped) {
  const period = query.groupBy === "month" ? "YYYY-MM" : "YYYY-MM-DD";
  const rows = await tx.execute<SummaryRow>(sql`
    SELECT to_char(r.business_date, ${period}) AS period, r.branch_id AS "branchId",
      r.currency,
      sum(r.invoiced_minor)::text AS "invoicedMinor", sum(r.discount_minor)::text AS "discountMinor",
      sum(r.tax_minor)::text AS "taxMinor", sum(r.collected_minor)::text AS "collectedMinor",
      sum(r.refunded_minor)::text AS "refundedMinor",
      sum(r.credit_applied_minor)::text AS "creditAppliedMinor", sum(r.void_count)::int AS "voidCount"
    FROM finance_report_period_summary(${query.from}::date, ${query.to}::date,
      ${uuidArray(ctx.branchIds)}) r
    GROUP BY 1, 2, r.currency ORDER BY 1, 2`);
  return {
    rows: branchReportItems(ctx, rows),
    totals: {
      invoicedMinor: sumReportMoney(rows, "invoicedMinor"),
      discountMinor: sumReportMoney(rows, "discountMinor"),
      taxMinor: sumReportMoney(rows, "taxMinor"),
      collectedMinor: sumReportMoney(rows, "collectedMinor"),
      refundedMinor: sumReportMoney(rows, "refundedMinor"),
      creditAppliedMinor: sumReportMoney(rows, "creditAppliedMinor"),
      voidCount: rows.reduce((sum, row) => sum + row.voidCount, 0),
    },
  };
}

export async function reportCashClosings(
  tx: Tx,
  ctx: ReportContext,
  query: ReportQuery,
  staff: BillingReportStaff,
) {
  const raw = await tx.execute<Omit<ClosingRow, "closedByName">>(sql`
    SELECT r.closing_id AS "closingId", r.branch_id AS "branchId",
      r.business_date::text AS "businessDate",
      r.expected_minor::text AS "expectedMinor", r.counted_minor::text AS "countedMinor",
      r.difference_minor::text AS "differenceMinor", r.closed_by AS "closedBy",
      r.note_present AS "notePresent", r.currency
    FROM finance_report_cash_closings(${query.from}::date, ${query.to}::date,
      ${uuidArray(ctx.branchIds)}) r
    ORDER BY r.business_date, r.branch_id, r.closing_id`);
  const names = await staff.findMany(
    tx,
    ctx.clinicId,
    raw.map((row) => row.closedBy),
  );
  const rows = branchReportItems(ctx, raw).map((row) => ({
    ...row,
    closedByName: names.get(row.closedBy)?.fullName ?? null,
  }));
  return {
    rows,
    totals: {
      expectedMinor: sumReportMoney(rows, "expectedMinor"),
      countedMinor: sumReportMoney(rows, "countedMinor"),
      differenceMinor: sumReportMoney(rows, "differenceMinor"),
    },
  };
}
