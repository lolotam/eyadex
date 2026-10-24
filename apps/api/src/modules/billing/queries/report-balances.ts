import type * as reports from "@eyadex/contracts/finance-reports";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";
import type { z } from "zod";

import type { BillingPatientReader } from "../ports/billing-patients.ts";
import {
  branchName,
  patientReportItems,
  reportPage,
  uuidArray,
  type ReportContext,
  type ReportPageQuery,
} from "./report-sql.ts";

type OutstandingRow = Omit<z.infer<typeof reports.reportOutstandingRowSchema>, "patientName"> & {
  rowId: string;
};
type CreditRow = Omit<z.infer<typeof reports.reportPatientCreditRowSchema>, "patientName"> & {
  rowId: string;
};
type SummaryRow = z.infer<typeof reports.reportOutstandingSummaryRowSchema>;

export async function outstanding(
  tx: Tx,
  ctx: ReportContext,
  query: ReportPageQuery,
  today: string,
  patients: BillingPatientReader,
) {
  const relation = sql`SELECT v.id AS "rowId", v.id AS "invoiceId", i.number AS "invoiceNumber",
    v.branch_id AS "branchId", ${branchName(ctx.language)} AS "branchName",
    v.business_date::text AS "businessDate", v.patient_id AS "patientId",
    v.total_minor::text AS "totalMinor", v.paid_minor::text AS "paidMinor",
    v.owed_minor::text AS "owedMinor", v.currency,
    CASE WHEN ${today}::date - v.business_date <= 30 THEN '0_30'
      WHEN ${today}::date - v.business_date <= 60 THEN '31_60'
      WHEN ${today}::date - v.business_date <= 90 THEN '61_90' ELSE 'over_90' END AS "ageBucket"
    FROM finance_invoice_balances v
    JOIN invoices i ON i.clinic_id = v.clinic_id AND i.id = v.id
    JOIN branches b ON b.clinic_id = v.clinic_id AND b.id = v.branch_id
    WHERE v.clinic_id = ${ctx.clinicId} AND v.status = 'issued' AND v.owed_minor > 0
      AND v.branch_id = ANY(${uuidArray(ctx.branchIds)})
      AND v.business_date BETWEEN ${query.from}::date AND ${query.to}::date`;
  const page = await reportPage<OutstandingRow>(tx, query, relation);
  // Summary describes the filtered report, so a cursor must never reduce its buckets.
  const summary = await tx.execute<SummaryRow>(sql`
    SELECT r."ageBucket", r."branchId", count(*)::int AS "invoiceCount",
      sum(r."owedMinor"::bigint)::text AS "owedMinor" FROM (${relation}) r
    GROUP BY r."ageBucket", r."branchId" ORDER BY r."branchId", r."ageBucket"`);
  return {
    items: await patientReportItems(tx, ctx.clinicId, page.rows, patients),
    nextCursor: page.nextCursor,
    total: page.total,
    summary: [...summary],
  };
}

export async function patientCredit(
  tx: Tx,
  ctx: ReportContext,
  query: ReportPageQuery,
  patients: BillingPatientReader,
) {
  // Credit is a current clinic-wide balance, not a branch movement. The range does not cut its ledger.
  const remaining = sql`pc.amount_minor
    - coalesce((SELECT sum(a.amount_minor) FROM payment_allocations a
        WHERE a.clinic_id = pc.clinic_id AND a.credit_id = pc.id), 0)
    - coalesce((SELECT sum(s.amount_minor) FROM refund_sources s
        WHERE s.clinic_id = pc.clinic_id AND s.credit_id = pc.id), 0)`;
  const relation = sql`SELECT pc.patient_id AS "rowId", pc.patient_id AS "patientId",
    sum(${remaining})::text AS "balanceMinor",
    min((pc.created_at AT TIME ZONE c.timezone)::date)::text AS "oldestCreditDay", c.currency
    FROM patient_credits pc JOIN clinics c ON c.id = pc.clinic_id
    WHERE pc.clinic_id = ${ctx.clinicId}
    GROUP BY pc.patient_id, c.currency HAVING sum(${remaining}) > 0`;
  const page = await reportPage<CreditRow>(tx, query, relation);
  return {
    items: await patientReportItems(tx, ctx.clinicId, page.rows, patients),
    nextCursor: page.nextCursor,
    total: page.total,
  };
}
