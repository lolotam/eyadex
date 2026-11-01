import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  REPORT_EXPORT_COLUMNS,
  REPORT_IDS,
  reportByDoctorRowSchema,
  reportByServiceRowSchema,
  reportCashClosingRowSchema,
  reportDailyTakingsQuerySchema,
  reportDailyTakingsRowSchema,
  reportDiscountRowSchema,
  reportExportRequestSchema,
  reportExportStatusSchema,
  reportExportSchema,
  reportMonthSchema,
  reportOutstandingRowSchema,
  reportOwnSummaryRowSchema,
  reportPatientCreditRowSchema,
  reportPeriodSchema,
  reportPeriodSummaryRowSchema,
  reportRefundRowSchema,
  type ReportId,
} from "../finance-reports.ts";

const ID = "0198f0a0-0000-7000-8000-000000000001";

/** Every report row, so a rule about the rows holds for all of them. */
const ROWS = {
  daily_takings: reportDailyTakingsRowSchema,
  period_summary: reportPeriodSummaryRowSchema,
  by_service: reportByServiceRowSchema,
  by_doctor: reportByDoctorRowSchema,
  outstanding: reportOutstandingRowSchema,
  patient_credit: reportPatientCreditRowSchema,
  refunds: reportRefundRowSchema,
  discounts: reportDiscountRowSchema,
  cash_closings: reportCashClosingRowSchema,
  own_summary: reportOwnSummaryRowSchema,
} as const satisfies Record<ReportId, z.ZodTypeAny>;

type ReportRowSchema = (typeof ROWS)[keyof typeof ROWS];

/** The fields of a row, read from its schema. */
const rowShape = (row: ReportRowSchema): Record<string, z.ZodTypeAny> => row.shape;

/** The fields that name the staff member who did it: their membership id. */
const staffIdFields = (row: ReportRowSchema): string[] =>
  Object.keys(rowShape(row)).filter((key) => key.endsWith("By"));

/** Is the field a membership id? The uuid check of `idSchema`, read from the schema itself. */
const isMembershipId = (field: z.ZodTypeAny | undefined): boolean =>
  field !== undefined && field.safeParse(ID).success && !field.safeParse("Synthetic staff").success;

/** The keys of the columns of one report's export (spec §7.1). */
const columnKeys = (report: ReportId): string[] =>
  REPORT_EXPORT_COLUMNS[report].map((column) => column.key);

describe("the staff member a report row names (spec §4)", () => {
  it("names the staff member of R7, R8 and R9", () => {
    expect(staffIdFields(ROWS.refunds)).toEqual(["refundedBy"]);
    expect(staffIdFields(ROWS.discounts)).toEqual(["discountedBy"]);
    expect(staffIdFields(ROWS.cash_closings)).toEqual(["closedBy"]);
  });

  it("carries the name of the staff member next to the id", () => {
    for (const [report, row] of Object.entries(ROWS)) {
      for (const key of staffIdFields(row)) {
        const name = rowShape(row)[`${key}Name`];
        expect(name, `${report}.${key}Name`).toBeDefined();
        expect(name?.safeParse("Synthetic staff").success, `${report}.${key}Name`).toBe(true);
        expect(name?.safeParse(null).success, `${report}.${key}Name`).toBe(true);
        expect(name?.safeParse(undefined).success, `${report}.${key}Name`).toBe(false);
      }
    }
  });

  it("keeps the id a membership id", () => {
    for (const [report, row] of Object.entries(ROWS)) {
      for (const key of staffIdFields(row)) {
        const id = rowShape(row)[key];
        expect(id?.safeParse(ID).success, `${report}.${key}`).toBe(true);
        expect(id?.safeParse("Synthetic staff").success, `${report}.${key}`).toBe(false);
      }
    }
  });
});

describe("the export columns (spec §7.1)", () => {
  it("reads no membership id in any column of any report", () => {
    for (const report of REPORT_IDS) {
      const shape = rowShape(ROWS[report]);
      for (const column of REPORT_EXPORT_COLUMNS[report]) {
        expect(shape[column.key], `${report}.${column.key}`).toBeDefined();
        expect(isMembershipId(shape[column.key]), `${report}.${column.key}`).toBe(false);
      }
    }
  });

  it("reads the name of the staff member, never the id", () => {
    expect(columnKeys("refunds")).toContain("refundedByName");
    expect(columnKeys("discounts")).toContain("discountedByName");
    expect(columnKeys("cash_closings")).toContain("closedByName");
    expect(columnKeys("refunds")).not.toContain("refundedBy");
    expect(columnKeys("discounts")).not.toContain("discountedBy");
    expect(columnKeys("cash_closings")).not.toContain("closedBy");
  });

  it("reads the name of the doctor, never the provider id", () => {
    expect(columnKeys("by_doctor")).toContain("name");
    expect(columnKeys("by_doctor")).not.toContain("providerId");
  });
});

describe("the report period (spec §4)", () => {
  it("accepts a real day and a real month", () => {
    expect(reportPeriodSchema.safeParse("2026-10-23").success).toBe(true);
    expect(reportPeriodSchema.safeParse("2026-10").success).toBe(true);
  });

  it("refuses a month that does not exist", () => {
    expect(reportPeriodSchema.safeParse("2026-13-01").success).toBe(false);
    expect(reportPeriodSchema.safeParse("2026-13").success).toBe(false);
    expect(reportPeriodSchema.safeParse("2026-00").success).toBe(false);
    expect(reportPeriodSchema.safeParse("2026-00-01").success).toBe(false);
  });

  it("refuses a day that does not exist", () => {
    expect(reportPeriodSchema.safeParse("2026-02-30").success).toBe(false);
    expect(reportPeriodSchema.safeParse("2026-04-31").success).toBe(false);
    expect(reportPeriodSchema.safeParse("2026-02-29").success).toBe(false);
  });

  it("accepts the leap day", () => {
    expect(reportPeriodSchema.safeParse("2028-02-29").success).toBe(true);
  });
});

describe("the report month (spec §4, R10)", () => {
  it("accepts a real month", () => {
    expect(reportMonthSchema.safeParse("2026-10").success).toBe(true);
    expect(reportMonthSchema.safeParse("2028-02").success).toBe(true);
  });

  it("refuses a month that does not exist", () => {
    expect(reportMonthSchema.safeParse("2026-13").success).toBe(false);
    expect(reportMonthSchema.safeParse("2026-00").success).toBe(false);
  });

  it("refuses an impossible month on the row of R10", () => {
    const row = { period: "2026-13", billedMinor: "5000", currency: "KWD" };
    expect(reportOwnSummaryRowSchema.safeParse(row).success).toBe(false);
  });
});

describe("the range of a report (spec §4, §6)", () => {
  it("names a range that is too long with the i18n key", () => {
    const result = reportDailyTakingsQuerySchema.safeParse({
      from: "2024-01-01",
      to: "2026-01-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain("validation.rangeTooLong");
      expect(messages).not.toContain("report_range_too_long");
    }
  });

  it("keeps the backwards range on its own key", () => {
    const result = reportDailyTakingsQuerySchema.safeParse({
      from: "2026-03-01",
      to: "2026-02-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain("validation.dateOrder");
    }
  });

  it("names the too-long range of an export with the same key", () => {
    const result = reportExportRequestSchema.safeParse({
      report: "daily_takings",
      from: "2020-01-01",
      to: "2026-10-01",
      format: "csv",
      language: "ar",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain("validation.rangeTooLong");
      expect(messages).not.toContain("report_range_too_long");
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
