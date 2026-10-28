import * as reports from "@eyadex/contracts/finance-reports";
import { branchOptionListResponseSchema } from "@eyadex/contracts/role-admin";
import type { z } from "zod";
import type { ReportsApi } from "../reports-client";
import type { HttpContext } from "./http-context";
import { createHttpReportExports } from "./http-report-exports";

/**
 * `GET /v1/finance-reports/<id>`. The query goes as typed, so the API alone judges it (a too-long range
 * answers `report_range_too_long`, never a local parse error); every answer is parsed by its schema.
 */
export function createHttpReports(ctx: HttpContext): ReportsApi {
  const { transport } = ctx;
  const get =
    <Q extends z.ZodTypeAny, R extends z.ZodTypeAny>(path: string, _query: Q, schema: R) =>
    (_persona: unknown, query: z.input<Q>): Promise<z.infer<R>> =>
      transport.send("GET", `/v1/finance-reports/${path}`, {
        schema,
        query: query as Record<string, string | number | undefined>,
      });
  return {
    ...createHttpReportExports(ctx),
    branchOptions: (_persona, report, query) =>
      transport.send(
        "GET",
        `/v1/finance-reports/${encodeURIComponent(report.replaceAll("_", "-"))}/branch-options`,
        {
          schema: branchOptionListResponseSchema,
          query,
        },
      ),
    dailyTakings: get(
      "daily-takings",
      reports.reportDailyTakingsQuerySchema,
      reports.reportDailyTakingsResponseSchema,
    ),
    periodSummary: get(
      "period-summary",
      reports.reportPeriodSummaryQuerySchema,
      reports.reportPeriodSummaryResponseSchema,
    ),
    byService: get(
      "by-service",
      reports.reportByServiceQuerySchema,
      reports.reportByServiceResponseSchema,
    ),
    byDoctor: get(
      "by-doctor",
      reports.reportByDoctorQuerySchema,
      reports.reportByDoctorResponseSchema,
    ),
    outstanding: get(
      "outstanding",
      reports.reportOutstandingQuerySchema,
      reports.reportOutstandingResponseSchema,
    ),
    patientCredit: get(
      "patient-credit",
      reports.reportPatientCreditQuerySchema,
      reports.reportPatientCreditResponseSchema,
    ),
    refunds: get("refunds", reports.reportRefundQuerySchema, reports.reportRefundResponseSchema),
    discounts: get(
      "discounts",
      reports.reportDiscountQuerySchema,
      reports.reportDiscountResponseSchema,
    ),
    cashClosings: get(
      "cash-closings",
      reports.reportCashClosingQuerySchema,
      reports.reportCashClosingResponseSchema,
    ),
    ownSummary: get(
      "own-summary",
      reports.reportOwnSummaryQuerySchema,
      reports.reportOwnSummaryResponseSchema,
    ),
  };
}
