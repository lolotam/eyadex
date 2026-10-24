import type * as reports from "@eyadex/contracts/finance-reports";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";
import type { z } from "zod";

import { analyticsTotals, sumReportMoney } from "../domain/report-totals.ts";
import type { BillingPatientReader } from "../ports/billing-patients.ts";
import type { BillingReportStaff } from "../ports/billing-report-staff.ts";
import type { BillingReportServices } from "../ports/billing-report-services.ts";
import { uuidArray, type ReportContext, type ReportQuery } from "./report-sql.ts";

type ServiceRow = z.infer<typeof reports.reportByServiceRowSchema>;
type DoctorRow = z.infer<typeof reports.reportByDoctorRowSchema>;
type OwnRow = z.infer<typeof reports.reportOwnSummaryRowSchema>;

export async function byService(
  tx: Tx,
  ctx: ReportContext,
  query: ReportQuery,
  services: BillingReportServices,
) {
  const raw = await tx.execute<Omit<ServiceRow, "name">>(sql`
    SELECT r.kind, r.service_id AS "serviceId",
      r.line_count AS "lineCount", r.quantity, r.amount_minor::text AS "amountMinor", r.currency
    FROM finance_report_by_service(${query.from}::date, ${query.to}::date,
      ${uuidArray(ctx.branchIds)}) r
    ORDER BY r.kind, r.service_id`);
  const names = await services.namesOf(
    tx,
    ctx.clinicId,
    raw.flatMap((row) => (row.serviceId === null ? [] : [row.serviceId])),
  );
  const rows = raw.map((row) => {
    const service = row.serviceId === null ? undefined : names.get(row.serviceId);
    return {
      ...row,
      name:
        row.kind === "tax"
          ? ctx.language === "ar"
            ? "الضريبة"
            : "Tax"
          : row.kind === "free"
            ? ctx.language === "ar"
              ? "بنود حرة"
              : "Free lines"
            : ((ctx.language === "ar" ? service?.nameAr : service?.nameEn) ?? "—"),
    };
  });
  return { rows, totals: analyticsTotals(rows) };
}

export async function byDoctor(
  tx: Tx,
  ctx: ReportContext,
  query: ReportQuery,
  staff: BillingReportStaff,
) {
  const raw = await tx.execute<Omit<DoctorRow, "name">>(sql`
    SELECT r.kind, r.provider_id AS "providerId", r.line_count AS "lineCount",
      r.quantity, r.amount_minor::text AS "amountMinor", r.currency
    FROM finance_report_by_doctor(${query.from}::date, ${query.to}::date,
      ${uuidArray(ctx.branchIds)}) r ORDER BY r.kind, r.provider_id`);
  const names = await staff.findMany(
    tx,
    ctx.clinicId,
    raw.flatMap((row) => (row.providerId === null ? [] : [row.providerId])),
  );
  const rows = raw.map((row) => ({
    ...row,
    name:
      row.kind === "tax"
        ? ctx.language === "ar"
          ? "الضريبة"
          : "Tax"
        : row.kind === "none"
          ? ctx.language === "ar"
            ? "بدون دكتور"
            : "No doctor"
          : (names.get(row.providerId!)?.fullName ?? "—"),
  }));
  return { rows, totals: analyticsTotals(rows) };
}

export async function ownSummary(
  tx: Tx,
  ctx: ReportContext,
  query: ReportQuery,
  membershipId: string,
  patients: BillingPatientReader,
) {
  // This is the invoice list's patient predicate; line ownership only narrows that same reach.
  const own = patients.ownPatientFilter(membershipId, sql`i.patient_id`);
  const rows = await tx.execute<OwnRow>(sql`
    SELECT to_char(i.issued_at AT TIME ZONE c.timezone, 'YYYY-MM') AS period,
      sum(l.line_total_minor)::text AS "billedMinor", i.currency
    FROM invoices i JOIN clinics c ON c.id = i.clinic_id
    JOIN invoice_lines l ON l.clinic_id = i.clinic_id AND l.invoice_id = i.id
    WHERE i.clinic_id = ${ctx.clinicId} AND i.status = 'issued'
      AND i.branch_id = ANY(${uuidArray(ctx.branchIds)}) AND ${own}
      AND l.archived_at IS NULL AND l.provider_id = ${membershipId}::uuid
      AND i.issued_at >= (${query.from}::date::timestamp AT TIME ZONE c.timezone)
      AND i.issued_at < ((${query.to}::date + 1)::timestamp AT TIME ZONE c.timezone)
    GROUP BY 1, i.currency ORDER BY 1`);
  return { rows: [...rows], totals: { billedMinor: sumReportMoney(rows, "billedMinor") } };
}
