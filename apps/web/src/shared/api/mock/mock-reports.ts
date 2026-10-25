import * as reports from "@eyadex/contracts/finance-reports";
import type { ReportId } from "@eyadex/contracts/finance-reports";
import type { Persona } from "@eyadex/contracts/session";
import type { z } from "zod";
import type { ReportsApi } from "../reports-client";
import { openReport, type ReportContext } from "./mock-report-access";
import { discounts, refunds } from "./mock-report-adjustments";
import { byDoctor, byService, ownSummary } from "./mock-report-analytics";
import { outstanding, patientCredit } from "./mock-report-balances";
import { cashClosings, dailyTakings, periodSummary } from "./mock-report-takings";
import { delay, getState, type MockState } from "./mock-store";

/**
 * One report: opened in the API's order, built from the mock state, answered with the clinic's currency
 * and parsed by the contract's response schema, as the controller does.
 */
export function readReport<Q extends z.ZodTypeAny, R extends z.ZodTypeAny>(
  db: MockState,
  persona: Persona,
  report: ReportId,
  querySchema: Q,
  responseSchema: R,
  raw: unknown,
  build: (ctx: ReportContext, query: z.infer<Q>) => object,
): z.infer<R> {
  const { ctx, query } = openReport(db, persona, report, querySchema, raw);
  return responseSchema.parse({ ...build(ctx, query), ...ctx.facts });
}

/** The `reports` namespace of the mock (F3 slice 3): the API's rules and order on the mock state. */
export function createMockReports(now: () => Date = () => new Date()): ReportsApi {
  const run =
    <Q extends z.ZodTypeAny, R extends z.ZodTypeAny>(
      report: ReportId,
      q: Q,
      r: R,
      build: (ctx: ReportContext, query: z.infer<Q>) => object,
    ) =>
    async (persona: Persona, raw: z.input<Q>): Promise<z.infer<R>> => {
      await delay();
      return readReport(getState(), persona, report, q, r, raw, build);
    };
  return {
    dailyTakings: run(
      "daily_takings",
      reports.reportDailyTakingsQuerySchema,
      reports.reportDailyTakingsResponseSchema,
      dailyTakings,
    ),
    periodSummary: run(
      "period_summary",
      reports.reportPeriodSummaryQuerySchema,
      reports.reportPeriodSummaryResponseSchema,
      periodSummary,
    ),
    byService: run(
      "by_service",
      reports.reportByServiceQuerySchema,
      reports.reportByServiceResponseSchema,
      byService,
    ),
    byDoctor: run(
      "by_doctor",
      reports.reportByDoctorQuerySchema,
      reports.reportByDoctorResponseSchema,
      byDoctor,
    ),
    outstanding: run(
      "outstanding",
      reports.reportOutstandingQuerySchema,
      reports.reportOutstandingResponseSchema,
      (ctx, q) => outstanding(ctx, q, now()),
    ),
    patientCredit: run(
      "patient_credit",
      reports.reportPatientCreditQuerySchema,
      reports.reportPatientCreditResponseSchema,
      patientCredit,
    ),
    refunds: run(
      "refunds",
      reports.reportRefundQuerySchema,
      reports.reportRefundResponseSchema,
      refunds,
    ),
    discounts: run(
      "discounts",
      reports.reportDiscountQuerySchema,
      reports.reportDiscountResponseSchema,
      discounts,
    ),
    cashClosings: run(
      "cash_closings",
      reports.reportCashClosingQuerySchema,
      reports.reportCashClosingResponseSchema,
      cashClosings,
    ),
    ownSummary: run(
      "own_summary",
      reports.reportOwnSummaryQuerySchema,
      reports.reportOwnSummaryResponseSchema,
      ownSummary,
    ),
  };
}
