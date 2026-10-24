import type * as reports from "@eyadex/contracts/finance-reports";
import type { Tx } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";
import type { z } from "zod";

import type { BillingPatientReader } from "../ports/billing-patients.ts";
import type { BillingReportStaff } from "../ports/billing-report-staff.ts";
import {
  branchName,
  patientReportItems,
  reportPage,
  uuidArray,
  type ReportContext,
  type ReportPageQuery,
} from "./report-sql.ts";

type RefundRow = Omit<
  z.infer<typeof reports.reportRefundRowSchema>,
  "patientName" | "refundedByName"
> & { rowId: string };
type DiscountRow = Omit<
  z.infer<typeof reports.reportDiscountRowSchema>,
  "patientName" | "discountedByName"
> & { rowId: string };

export async function reportRefunds(
  tx: Tx,
  ctx: ReportContext,
  query: ReportPageQuery,
  patients: BillingPatientReader,
  staff: BillingReportStaff,
) {
  const relation = sql`SELECT f.id AS "rowId", f.id AS "refundId", f.refund_number AS "refundNumber",
    f.branch_id AS "branchId", ${branchName(ctx.language)} AS "branchName",
    f.business_date::text AS "businessDate", f.patient_id AS "patientId", f.method,
    CASE WHEN EXISTS (SELECT 1 FROM refund_sources s
      JOIN patient_credits pc ON pc.clinic_id = s.clinic_id AND pc.id = s.credit_id
      WHERE s.clinic_id = f.clinic_id AND s.refund_id = f.id AND pc.cause = 'refund')
      THEN 'payment' ELSE 'credit' END AS source,
    f.amount_minor::text AS "amountMinor", f.refunded_by AS "refundedBy", f.reason, f.currency
    FROM refunds f JOIN branches b ON b.clinic_id = f.clinic_id AND b.id = f.branch_id
    WHERE f.clinic_id = ${ctx.clinicId} AND f.branch_id = ANY(${uuidArray(ctx.branchIds)})
      AND f.business_date BETWEEN ${query.from}::date AND ${query.to}::date`;
  const page = await reportPage<RefundRow>(tx, query, relation);
  const named = await patientReportItems(tx, ctx.clinicId, page.rows, patients);
  const names = await staff.findMany(
    tx,
    ctx.clinicId,
    named.map((row) => row.refundedBy),
  );
  return {
    items: named.map((row) => ({
      ...row,
      refundedByName: names.get(row.refundedBy)?.fullName ?? null,
    })),
    nextCursor: page.nextCursor,
    total: page.total,
  };
}

// Same positive half-up arithmetic as invoice-totals.ts; numeric avoids overflow before division.
const lineDiscount = (discount: SQL, gross: SQL) => sql`CASE
  WHEN ${discount}->>'kind' = 'amount' THEN (${discount}->>'minor')::numeric
  WHEN ${discount}->>'kind' = 'pct'
    THEN floor((${gross} * (${discount}->>'bp')::numeric + 5000) / 10000)
  ELSE 0 END`;

export async function reportDiscounts(
  tx: Tx,
  ctx: ReportContext,
  query: ReportPageQuery,
  patients: BillingPatientReader,
  staff: BillingReportStaff,
) {
  const lineAmount = lineDiscount(
    sql`l.line_discount`,
    sql`l.unit_price_minor::numeric * l.quantity`,
  );
  // The saved invoice total includes every line discount; subtracting those leaves its own discount.
  const invoiceAmount = sql`i.discount_minor - (SELECT coalesce(sum(${lineAmount}), 0)
    FROM invoice_lines l WHERE l.clinic_id = i.clinic_id AND l.invoice_id = i.id
      AND l.archived_at IS NULL)`;
  const relation = sql`SELECT d.id AS "rowId", i.id AS "invoiceId", i.number AS "invoiceNumber",
    i.branch_id AS "branchId", ${branchName(ctx.language)} AS "branchName",
    (i.issued_at AT TIME ZONE c.timezone)::date::text AS "businessDate",
    i.patient_id AS "patientId", d.kind, d.amount::text AS "discountMinor",
    d.discounted_by AS "discountedBy", d.reason, i.currency
    FROM invoices i JOIN clinics c ON c.id = i.clinic_id
    JOIN branches b ON b.clinic_id = i.clinic_id AND b.id = i.branch_id
    CROSS JOIN LATERAL (
      SELECT l.id, 'line' AS kind, ${lineAmount} AS amount, l.discounted_by,
        l.line_discount->>'reason' AS reason
      FROM invoice_lines l WHERE l.clinic_id = i.clinic_id AND l.invoice_id = i.id
        AND l.archived_at IS NULL AND l.line_discount IS NOT NULL
      UNION ALL
      SELECT i.id, 'invoice', ${invoiceAmount}, i.discounted_by, i.invoice_discount->>'reason'
      WHERE i.invoice_discount IS NOT NULL
    ) d
    WHERE i.clinic_id = ${ctx.clinicId} AND i.status = 'issued'
      AND i.branch_id = ANY(${uuidArray(ctx.branchIds)})
      AND (i.issued_at AT TIME ZONE c.timezone)::date BETWEEN ${query.from}::date AND ${query.to}::date`;
  const page = await reportPage<DiscountRow>(tx, query, relation);
  const named = await patientReportItems(tx, ctx.clinicId, page.rows, patients);
  const names = await staff.findMany(
    tx,
    ctx.clinicId,
    named.flatMap((row) => (row.discountedBy === null ? [] : [row.discountedBy])),
  );
  return {
    items: named.map((row) => ({
      ...row,
      discountedByName:
        row.discountedBy === null ? null : (names.get(row.discountedBy)?.fullName ?? null),
    })),
    nextCursor: page.nextCursor,
    total: page.total,
  };
}
