import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  REPORT_IDS,
  REPORT_EXPORT_COLUMNS,
  reportByDoctorQuerySchema,
  reportByDoctorRowSchema,
  reportByServiceQuerySchema,
  reportByServiceRowSchema,
  reportCashClosingQuerySchema,
  reportCashClosingRowSchema,
  reportDailyTakingsQuerySchema,
  reportDailyTakingsRowSchema,
  reportDiscountQuerySchema,
  reportDiscountRowSchema,
  reportExportRequestSchema,
  reportExportSchema,
  reportExportStatusSchema,
  reportOutstandingQuerySchema,
  reportOutstandingRowSchema,
  reportOwnSummaryQuerySchema,
  reportOwnSummaryRowSchema,
  reportPatientCreditQuerySchema,
  reportPatientCreditRowSchema,
  reportPeriodSummaryQuerySchema,
  reportPeriodSummaryRowSchema,
  reportRefundQuerySchema,
  reportRefundRowSchema,
  type ReportId,
} from "../finance-reports.ts";

const ID = "0198f0a0-0000-7000-8000-000000000001";
const BRANCH = { branchId: ID, branchName: "Synthetic branch", currency: "KWD" };
const PATIENT = { patientId: ID, patientName: "Synthetic patient" };

/** The fields a report row accepts, read from its schema. */
const rowKeys = (schema: z.ZodTypeAny): readonly string[] =>
  Object.keys((schema as z.ZodObject<z.ZodRawShape>).shape);

type ReportCase = {
  readonly report: ReportId;
  readonly query: z.ZodTypeAny;
  readonly row: z.ZodTypeAny;
  readonly example: Record<string, unknown>;
};

const REPORTS: readonly ReportCase[] = [
  {
    report: "daily_takings",
    query: reportDailyTakingsQuerySchema,
    row: reportDailyTakingsRowSchema,
    example: {
      ...BRANCH,
      period: "2026-10-01",
      method: "cash",
      inMinor: "1000",
      outMinor: "0",
      netMinor: "1000",
    },
  },
  {
    report: "period_summary",
    query: reportPeriodSummaryQuerySchema,
    row: reportPeriodSummaryRowSchema,
    example: {
      ...BRANCH,
      period: "2026-10",
      invoicedMinor: "5000",
      discountMinor: "500",
      taxMinor: "0",
      collectedMinor: "3000",
      refundedMinor: "0",
      creditAppliedMinor: "200",
      voidCount: 1,
    },
  },
  {
    report: "by_service",
    query: reportByServiceQuerySchema,
    row: reportByServiceRowSchema,
    example: {
      currency: "KWD",
      kind: "service",
      serviceId: ID,
      name: "Synthetic service",
      lineCount: 2,
      quantity: 3,
      amountMinor: "5000",
    },
  },
  {
    report: "by_doctor",
    query: reportByDoctorQuerySchema,
    row: reportByDoctorRowSchema,
    example: {
      currency: "KWD",
      kind: "doctor",
      providerId: ID,
      name: "Synthetic doctor",
      lineCount: 2,
      quantity: 3,
      amountMinor: "5000",
    },
  },
  {
    report: "outstanding",
    query: reportOutstandingQuerySchema,
    row: reportOutstandingRowSchema,
    example: {
      ...BRANCH,
      invoiceId: ID,
      invoiceNumber: "SLM-2026-000001",
      businessDate: "2026-10-01",
      ...PATIENT,
      totalMinor: "5000",
      paidMinor: "1000",
      owedMinor: "4000",
      ageBucket: "0_30",
    },
  },
  {
    report: "patient_credit",
    query: reportPatientCreditQuerySchema,
    row: reportPatientCreditRowSchema,
    example: {
      ...PATIENT,
      balanceMinor: "1500",
      oldestCreditDay: "2026-09-01",
      currency: "KWD",
    },
  },
  {
    report: "refunds",
    query: reportRefundQuerySchema,
    row: reportRefundRowSchema,
    example: {
      ...BRANCH,
      refundId: ID,
      refundNumber: "SLM-R-2026-000001",
      businessDate: "2026-10-01",
      ...PATIENT,
      method: "cash",
      source: "payment",
      amountMinor: "500",
      refundedBy: ID,
      reason: "Duplicate receipt",
    },
  },
  {
    report: "discounts",
    query: reportDiscountQuerySchema,
    row: reportDiscountRowSchema,
    example: {
      ...BRANCH,
      invoiceId: ID,
      invoiceNumber: "SLM-2026-000001",
      businessDate: "2026-10-01",
      ...PATIENT,
      kind: "line",
      discountMinor: "300",
      discountedBy: null,
      reason: "Courtesy",
    },
  },
  {
    report: "cash_closings",
    query: reportCashClosingQuerySchema,
    row: reportCashClosingRowSchema,
    example: {
      ...BRANCH,
      closingId: ID,
      businessDate: "2026-10-01",
      expectedMinor: "1000",
      countedMinor: "900",
      differenceMinor: "-100",
      closedBy: ID,
      notePresent: true,
    },
  },
  {
    report: "own_summary",
    query: reportOwnSummaryQuerySchema,
    row: reportOwnSummaryRowSchema,
    example: { period: "2026-10", billedMinor: "5000", currency: "KWD" },
  },
];

describe.each(REPORTS)("$report", ({ query, row, example }) => {
  it("refuses a range that runs backwards", () => {
    expect(query.safeParse({ from: "2026-03-01", to: "2026-02-01" }).success).toBe(false);
  });

  it("refuses a range longer than the maximum", () => {
    const result = query.safeParse({ from: "2024-01-01", to: "2026-01-01" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain("report_range_too_long");
    }
  });

  it("accepts a range inside the maximum", () => {
    expect(query.safeParse({ from: "2026-10-01", to: "2026-10-31" }).success).toBe(true);
  });

  it("accepts its own row shape and refuses an extra field", () => {
    expect(row.safeParse(example).success).toBe(true);
    expect(row.safeParse({ ...example, unexpected: "x" }).success).toBe(false);
  });
});

describe("the patient-named reports (spec §4, R5–R8)", () => {
  const named = ["outstanding", "patient_credit", "refunds", "discounts"];
  it("names the patient on R5–R8 and on no other report", () => {
    for (const { report, row } of REPORTS) {
      expect(rowKeys(row).includes("patientName"), report).toBe(named.includes(report));
    }
  });
});

describe("the export row (spec §7.3)", () => {
  const STATUSES = ["queued", "running", "done", "failed", "expired", "purged"];
  const exportRow = {
    id: ID,
    report: "daily_takings",
    format: "csv",
    status: "queued",
    createdAt: "2026-10-23T08:00:00.000Z",
    expiresAt: null,
    byteSize: null,
    rowCount: null,
  };

  it("carries exactly the six statuses of the export table", () => {
    expect(reportExportStatusSchema.options).toEqual(STATUSES);
  });

  it("accepts the row of a queued export", () => {
    expect(reportExportSchema.safeParse(exportRow).success).toBe(true);
  });

  it("refuses a patient field", () => {
    expect(reportExportSchema.safeParse({ ...exportRow, patientId: ID }).success).toBe(false);
  });
});

describe("the export request (spec §7.1, §7.2)", () => {
  const request = {
    report: "daily_takings",
    from: "2026-01-01",
    to: "2026-10-01",
    format: "csv",
    language: "ar",
  };

  it("accepts a report with its filters", () => {
    expect(reportExportRequestSchema.safeParse(request).success).toBe(true);
  });

  it("refuses a range longer than three years", () => {
    const result = reportExportRequestSchema.safeParse({
      ...request,
      from: "2020-01-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain("report_range_too_long");
    }
  });

  it("refuses a grouping on a report that has none", () => {
    const grouped = { ...request, report: "refunds", groupBy: "day" };
    expect(reportExportRequestSchema.safeParse(grouped).success).toBe(false);
  });

  it("refuses a format or a language it does not know", () => {
    expect(reportExportRequestSchema.safeParse({ ...request, format: "pdf" }).success).toBe(false);
    expect(reportExportRequestSchema.safeParse({ ...request, language: "fr" }).success).toBe(false);
  });
});

describe("the export columns (spec §7.1)", () => {
  it("gives every report its columns", () => {
    for (const report of REPORT_IDS) {
      expect(REPORT_EXPORT_COLUMNS[report].length, report).toBeGreaterThan(0);
    }
  });

  it("reads only fields its own row carries", () => {
    for (const { report, row } of REPORTS) {
      const keys = rowKeys(row);
      for (const column of REPORT_EXPORT_COLUMNS[report]) {
        expect(keys, `${report}.${column.key}`).toContain(column.key);
      }
    }
  });
});
