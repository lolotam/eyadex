import * as reports from "@eyadex/contracts/finance-reports";
import { describe, expect, it } from "vitest";

import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { analyticsTotals, sumReportMoney } from "../domain/report-totals.ts";

describe("on-screen report validation", () => {
  it.each([
    reports.reportDailyTakingsQuerySchema,
    reports.reportPeriodSummaryQuerySchema,
    reports.reportByServiceQuerySchema,
    reports.reportByDoctorQuerySchema,
    reports.reportOutstandingQuerySchema,
    reports.reportPatientCreditQuerySchema,
    reports.reportRefundQuerySchema,
    reports.reportDiscountQuerySchema,
    reports.reportCashClosingQuerySchema,
    reports.reportOwnSummaryQuerySchema,
  ])("maps an inclusive 367-day range to the bilingual 400 error", (schema) => {
    const pipe = new ZodValidationPipe(schema);
    expect(() => pipe.transform({ from: "2026-01-01", to: "2027-01-02" })).toThrow(
      expect.objectContaining({ code: "report_range_too_long", status: 400 }),
    );
    expect(pipe.transform({ from: "2026-01-01", to: "2027-01-01" })).toBeDefined();
    const envelope = new ApiError("report_range_too_long").toEnvelope();
    expect(envelope.message_ar).toBeTruthy();
    expect(envelope.message_en).toBeTruthy();
  });

  it("keeps invalid dates and reversed ranges as validation without exposing input", () => {
    const pipe = new ZodValidationPipe(reports.reportByServiceQuerySchema);
    for (const query of [
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2026-03-02", to: "2026-03-01" },
    ])
      expect(() => pipe.transform(query)).toThrow(expect.objectContaining({ code: "validation" }));
  });
});

it("sums money beyond JS integer precision and keeps tax separate from billed lines", () => {
  expect(sumReportMoney([{ value: "9007199254740993" }, { value: "2" }], "value")).toBe(
    "9007199254740995",
  );
  expect(
    analyticsTotals([
      { kind: "doctor", lineCount: 2, quantity: 3, amountMinor: "1001" },
      { kind: "none", lineCount: 1, quantity: 1, amountMinor: "999" },
      { kind: "tax", lineCount: 0, quantity: 0, amountMinor: "100" },
    ]),
  ).toEqual({
    lineCount: 3,
    quantity: 4,
    billedMinor: "2000",
    taxMinor: "100",
    totalMinor: "2100",
  });
});
