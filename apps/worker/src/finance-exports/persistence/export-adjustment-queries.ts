import { sql } from "@eyadex/db";
import type { PreparedExportJob } from "../ports/export-store.ts";

/** R7/R8 mirror the report API; exporting adds no money writes or reason in audit. */
export function adjustmentQuery(clinicId: string, job: PreparedExportJob) {
  const { from, to, branchIds } = job.params;
  const branches = sql`string_to_array(${branchIds.join(",")}, ',')::uuid[]`;
  if (job.report === "refunds")
    return sql`SELECT f.refund_number AS "refundNumber", f.branch_id AS "branchId",
    f.business_date::text AS "businessDate", f.patient_id AS "patientId", f.method,
    CASE WHEN EXISTS (SELECT 1 FROM refund_sources s
      JOIN patient_credits pc ON pc.clinic_id = s.clinic_id AND pc.id = s.credit_id
      WHERE s.clinic_id = f.clinic_id AND s.refund_id = f.id AND pc.cause = 'refund')
      THEN 'payment' ELSE 'credit' END AS source,
    f.amount_minor::text AS "amountMinor", f.refunded_by AS "refundedBy", f.reason, f.currency
    FROM refunds f WHERE f.clinic_id = ${clinicId} AND f.branch_id = ANY(${branches})
      AND f.business_date BETWEEN ${from}::date AND ${to}::date ORDER BY f.id`;
  const lineAmount = sql`CASE
    WHEN l.line_discount->>'kind' = 'amount' THEN (l.line_discount->>'minor')::numeric
    WHEN l.line_discount->>'kind' = 'pct' THEN floor((l.unit_price_minor::numeric * l.quantity
      * (l.line_discount->>'bp')::numeric + 5000) / 10000) ELSE 0 END`;
  const invoiceAmount = sql`i.discount_minor - (SELECT coalesce(sum(${lineAmount}), 0)
    FROM invoice_lines l WHERE l.clinic_id = i.clinic_id AND l.invoice_id = i.id AND l.archived_at IS NULL)`;
  return sql`SELECT i.number AS "invoiceNumber", i.branch_id AS "branchId",
    (i.issued_at AT TIME ZONE c.timezone)::date::text AS "businessDate", i.patient_id AS "patientId",
    d.kind, d.amount::text AS "discountMinor", d.discounted_by AS "discountedBy", d.reason, i.currency
    FROM invoices i JOIN clinics c ON c.id = i.clinic_id CROSS JOIN LATERAL (
      SELECT l.id, 'line' AS kind, ${lineAmount} AS amount, l.discounted_by, l.line_discount->>'reason' AS reason
      FROM invoice_lines l WHERE l.clinic_id = i.clinic_id AND l.invoice_id = i.id
        AND l.archived_at IS NULL AND l.line_discount IS NOT NULL
      UNION ALL SELECT i.id, 'invoice', ${invoiceAmount}, i.discounted_by, i.invoice_discount->>'reason'
      WHERE i.invoice_discount IS NOT NULL
    ) d WHERE i.clinic_id = ${clinicId} AND i.status = 'issued' AND i.branch_id = ANY(${branches})
      AND (i.issued_at AT TIME ZONE c.timezone)::date BETWEEN ${from}::date AND ${to}::date ORDER BY d.id`;
}
