import * as reports from "@eyadex/contracts/finance-reports";
import type { z } from "zod";
import type { ReportsApi } from "../reports-client";
import type { HttpContext } from "./http-context";

/** `GET /v1/finance-reports/<id>`: the query is checked by its contract first, the answer parsed by its own. */
export function createHttpReports({ transport }: HttpContext): ReportsApi {
  const get =
    <Q extends z.ZodTypeAny, R extends z.ZodTypeAny>(path: string, querySchema: Q, schema: R) =>
    (_persona: unknown, raw: z.input<Q>): Promise<z.infer<R>> => {
      const query = querySchema.parse(raw) as Record<string, string | number | undefined>;
      return transport.send("GET", `/v1/finance-reports/${path}`, { schema, query });
    };
  return {
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
