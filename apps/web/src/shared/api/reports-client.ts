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
