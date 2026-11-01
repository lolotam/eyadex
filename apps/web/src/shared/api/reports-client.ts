import type * as reports from "@eyadex/contracts/finance-reports";
import type { Persona } from "@eyadex/contracts/session";
import type { z } from "zod";

type Report<Q extends z.ZodTypeAny, R extends z.ZodTypeAny> = (
  persona: Persona,
  query: z.input<Q>,
) => Promise<z.infer<R>>;

/**
 * Finance F3 (spec §3–§6): the ten on-screen reports. Each needs its report key and the key of the data
 * it reads, at the report's scope; a range is at most 366 clinic days (`report_range_too_long`).
 */
export interface ReportsApi {
  /** R1: money in and out per day (or month), branch and method. */
  dailyTakings: Report<
    typeof reports.reportDailyTakingsQuerySchema,
    typeof reports.reportDailyTakingsResponseSchema
  >;
  /** R2: invoiced, collected, refunded and credit applied per month (or day) and branch. */
  periodSummary: Report<
    typeof reports.reportPeriodSummaryQuerySchema,
    typeof reports.reportPeriodSummaryResponseSchema
  >;
  /** R3: billed per service; the tax is one of the rows. */
  byService: Report<
    typeof reports.reportByServiceQuerySchema,
    typeof reports.reportByServiceResponseSchema
  >;
  /** R4: billed per doctor; lines with no doctor are one row. */
  byDoctor: Report<
    typeof reports.reportByDoctorQuerySchema,
    typeof reports.reportByDoctorResponseSchema
  >;
  /** R5: issued invoices that still owe, by age bucket; a page at a time. */
  outstanding: Report<
    typeof reports.reportOutstandingQuerySchema,
    typeof reports.reportOutstandingResponseSchema
  >;
  /** R6: patients with available credit; clinic scope only. */
  patientCredit: Report<
    typeof reports.reportPatientCreditQuerySchema,
    typeof reports.reportPatientCreditResponseSchema
  >;
  /** R7: one row per refund. */
  refunds: Report<
    typeof reports.reportRefundQuerySchema,
    typeof reports.reportRefundResponseSchema
  >;
  /** R8: one row per discount of an issued invoice. */
  discounts: Report<
    typeof reports.reportDiscountQuerySchema,
    typeof reports.reportDiscountResponseSchema
  >;
  /** R9: the saved cash closings. */
  cashClosings: Report<
    typeof reports.reportCashClosingQuerySchema,
    typeof reports.reportCashClosingResponseSchema
  >;
  /** R10: the doctor's own billed lines per month. */
  ownSummary: Report<
    typeof reports.reportOwnSummaryQuerySchema,
    typeof reports.reportOwnSummaryResponseSchema
  >;
}

type ExportResponse = z.infer<typeof reports.reportExportResponseSchema>;

/**
 * Finance F3 exports (spec §7): every export is a job for the requester alone. The request body and
 * list query go as typed, so the API judges them; the download is the file's bytes, never a URL.
 */
export interface ReportExportsApi {
  /** `POST /v1/finance-reports/exports`: queues one export (202). */
  requestExport(
    persona: Persona,
    body: z.input<typeof reports.reportExportRequestSchema>,
  ): Promise<ExportResponse>;
  /** `GET /v1/finance-reports/exports`: the caller's own exports, newest first. */
  listExports(
    persona: Persona,
    query: Partial<z.infer<typeof reports.reportExportListQuerySchema>>,
  ): Promise<z.infer<typeof reports.reportExportListResponseSchema>>;
  /** `GET /v1/finance-reports/exports/:id`: one of the caller's exports. */
  getExport(persona: Persona, exportId: string): Promise<ExportResponse>;
  /** `GET /v1/finance-reports/exports/:id/download`: the finished file. */
  downloadExport(persona: Persona, exportId: string): Promise<Blob>;
}
