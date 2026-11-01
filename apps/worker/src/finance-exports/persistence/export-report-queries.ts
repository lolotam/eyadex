import { sql } from "@eyadex/db";
import type { PreparedExportJob } from "../ports/export-store.ts";
import { adjustmentQuery } from "./export-adjustment-queries.ts";

export const uuidArray = (ids: readonly string[]) =>
  sql`string_to_array(${ids.join(",")}, ',')::uuid[]`;

/** Same patient reach as patients/queries/own-patients.ts; applied before own aggregation. */
export const ownPatient = (membershipId: string) => sql`EXISTS (SELECT 1 FROM patients p
  WHERE p.clinic_id = i.clinic_id AND p.id = i.patient_id AND (
    EXISTS (SELECT 1 FROM appointments a WHERE a.clinic_id = p.clinic_id AND a.patient_id = p.id
      AND a.provider_membership_id = ${membershipId}::uuid AND a.status <> 'cancelled')
    OR EXISTS (SELECT 1 FROM visits v WHERE v.clinic_id = p.clinic_id AND v.patient_id = p.id
      AND v.provider_membership_id = ${membershipId}::uuid)))`;

/** SQL reads the same pre-contract business day as the on-screen reports (ADR-0035). */
export function exportReportQuery(clinicId: string, job: PreparedExportJob, today: string) {
  const { from, to, branchIds, groupBy } = job.params;
  const branches = uuidArray(branchIds);
  const period = groupBy === "month" ? "YYYY-MM" : "YYYY-MM-DD";
  switch (job.report) {
    case "daily_takings":
      return sql`SELECT to_char(r.business_date, ${period}) AS period,
      r.branch_id AS "branchId", r.method, r.currency,
      sum(r.in_minor)::text AS "inMinor", sum(r.out_minor)::text AS "outMinor", sum(r.net_minor)::text AS "netMinor"
      FROM finance_report_daily_takings(${from}::date, ${to}::date, ${branches}) r
      GROUP BY 1, 2, r.method, r.currency ORDER BY 1, 2, r.method`;
    case "period_summary":
      return sql`SELECT to_char(r.business_date, ${period}) AS period,
      r.branch_id AS "branchId", r.currency,
      sum(r.invoiced_minor)::text AS "invoicedMinor", sum(r.discount_minor)::text AS "discountMinor",
      sum(r.tax_minor)::text AS "taxMinor", sum(r.collected_minor)::text AS "collectedMinor",
      sum(r.refunded_minor)::text AS "refundedMinor", sum(r.credit_applied_minor)::text AS "creditAppliedMinor",
      sum(r.void_count)::text AS "voidCount"
      FROM finance_report_period_summary(${from}::date, ${to}::date, ${branches}) r
      GROUP BY 1, 2, r.currency ORDER BY 1, 2`;
    case "by_service":
      return sql`SELECT r.kind, r.service_id AS "serviceId", r.line_count AS "lineCount",
      r.quantity, r.amount_minor::text AS "amountMinor", r.currency
      FROM finance_report_by_service(${from}::date, ${to}::date, ${branches}) r ORDER BY r.kind, r.service_id`;
    case "by_doctor":
      return sql`SELECT r.kind, r.provider_id AS "providerId", r.line_count AS "lineCount",
      r.quantity, r.amount_minor::text AS "amountMinor", r.currency
      FROM finance_report_by_doctor(${from}::date, ${to}::date, ${branches}) r ORDER BY r.kind, r.provider_id`;
    case "cash_closings":
      return sql`SELECT r.branch_id AS "branchId", r.business_date::text AS "businessDate",
      r.expected_minor::text AS "expectedMinor", r.counted_minor::text AS "countedMinor",
      r.difference_minor::text AS "differenceMinor", r.closed_by AS "closedBy", r.note_present AS "notePresent", r.currency
      FROM finance_report_cash_closings(${from}::date, ${to}::date, ${branches}) r
      ORDER BY r.business_date, r.branch_id, r.closing_id`;
    case "outstanding":
      return sql`SELECT i.number AS "invoiceNumber", v.branch_id AS "branchId",
      v.business_date::text AS "businessDate", v.patient_id AS "patientId", v.currency,
      v.total_minor::text AS "totalMinor", v.paid_minor::text AS "paidMinor", v.owed_minor::text AS "owedMinor",
      CASE WHEN ${today}::date - v.business_date <= 30 THEN '0_30'
        WHEN ${today}::date - v.business_date <= 60 THEN '31_60'
        WHEN ${today}::date - v.business_date <= 90 THEN '61_90' ELSE 'over_90' END AS "ageBucket"
      FROM finance_invoice_balances v JOIN invoices i ON i.clinic_id = v.clinic_id AND i.id = v.id
      WHERE v.clinic_id = ${clinicId} AND v.status = 'issued' AND v.owed_minor > 0
        AND v.branch_id = ANY(${branches}) AND v.business_date BETWEEN ${from}::date AND ${to}::date
      ORDER BY v.id`;
    case "patient_credit": {
      const remaining = sql`pc.amount_minor
        - coalesce((SELECT sum(a.amount_minor) FROM payment_allocations a
            WHERE a.clinic_id = pc.clinic_id AND a.credit_id = pc.id), 0)
        - coalesce((SELECT sum(s.amount_minor) FROM refund_sources s
            WHERE s.clinic_id = pc.clinic_id AND s.credit_id = pc.id), 0)`;
      return sql`SELECT pc.patient_id AS "patientId", sum(${remaining})::text AS "balanceMinor",
        min((pc.created_at AT TIME ZONE c.timezone)::date) FILTER (WHERE ${remaining} > 0)::text AS "oldestCreditDay", c.currency
        FROM patient_credits pc JOIN clinics c ON c.id = pc.clinic_id WHERE pc.clinic_id = ${clinicId}
        GROUP BY pc.patient_id, c.currency HAVING sum(${remaining}) > 0 ORDER BY pc.patient_id`;
    }
    case "own_summary":
      return sql`SELECT to_char(i.issued_at AT TIME ZONE c.timezone, 'YYYY-MM') AS period,
      sum(l.line_total_minor)::text AS "billedMinor", i.currency, jsonb_agg(DISTINCT i.patient_id) AS "patientIds"
      FROM invoices i JOIN clinics c ON c.id = i.clinic_id
      JOIN invoice_lines l ON l.clinic_id = i.clinic_id AND l.invoice_id = i.id
      WHERE i.clinic_id = ${clinicId} AND i.status = 'issued' AND i.branch_id = ANY(${branches})
        AND ${ownPatient(job.requestedBy)} AND l.archived_at IS NULL AND l.provider_id = ${job.requestedBy}::uuid
        AND i.issued_at >= ${from}::date - 2 AND i.issued_at < ${to}::date + 3
        AND (i.issued_at AT TIME ZONE c.timezone)::date BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1, i.currency ORDER BY 1`;
    case "refunds":
    case "discounts":
      return adjustmentQuery(clinicId, job);
  }
}
