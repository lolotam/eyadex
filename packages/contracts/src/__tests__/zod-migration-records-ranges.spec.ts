import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  reportDailyTakingsQuerySchema,
  reportExportRequestSchema,
  reportOutstandingQuerySchema,
  reportPeriodSummaryQuerySchema,
} from "../finance-reports.ts";
import { platformOverviewSchema } from "../platform.ts";
import { platformOverviewResponseSchema } from "../platform-console.ts";
import { setFeatureRequestSchema } from "../platform-clinics.ts";

type Parsed = { success: true; data: unknown } | { success: false; error: z.ZodError };

function issues(result: Parsed): z.ZodIssue[] {
  expect(result.success).toBe(false);
  if (result.success) return [];
  return result.error.issues;
}

const COUNTS = platformOverviewSchema.shape.counts;
const FULL_COUNTS = { trial: 0, active: 0, suspended: 0, expired: 0 };

describe("platformOverviewSchema counts", () => {
  it("accepts an empty record and a partial enum-key record", () => {
    expect(COUNTS.parse({})).toEqual({});
    expect(COUNTS.parse({ trial: 1 })).toEqual({ trial: 1 });
  });

  it("refuses an unknown key and a negative count without copying the value into a custom message", () => {
    expect(
      issues(COUNTS.safeParse({ mystery: 1 })).map((issue) => ({
        path: issue.path,
        code: issue.code,
      })),
    ).toEqual([{ path: [], code: "unrecognized_keys" }]);
    expect(
      issues(COUNTS.safeParse({ trial: -1 })).map((issue) => ({
        path: issue.path,
        code: issue.code,
      })),
    ).toEqual([{ path: ["trial"], code: "too_small" }]);
  });

  it("strips an unknown top-level key; the HTTP response schema does not", () => {
    expect(
      platformOverviewSchema.parse({
        counts: {},
        alertDaysBeforeExpiry: 7,
        expiringSoon: [],
        extra: true,
      }),
    ).toEqual({ counts: {}, alertDaysBeforeExpiry: 7, expiringSoon: [] });
    expect(
      platformOverviewResponseSchema.parse({
        counts: FULL_COUNTS,
        alertDaysBeforeExpiry: 7,
        expiringSoon: [],
      }).counts,
    ).toEqual(FULL_COUNTS);
    expect(
      platformOverviewResponseSchema.safeParse({
        counts: { trial: 1 },
        alertDaysBeforeExpiry: 7,
        expiringSoon: [],
      }).success,
    ).toBe(false);
    expect(
      issues(
        platformOverviewResponseSchema.safeParse({
          counts: FULL_COUNTS,
          alertDaysBeforeExpiry: 7,
          expiringSoon: [],
          extra: true,
        }),
      ).map((issue) => ({ path: issue.path, code: issue.code })),
    ).toEqual([{ path: [], code: "unrecognized_keys" }]);
  });
});

describe("strict keys, groupBy, and cursor defaults", () => {
  it("refuses an unknown key on a strict report query and a strict feature write", () => {
    expect(
      issues(
        reportDailyTakingsQuerySchema.safeParse({
          from: "2026-10-01",
          to: "2026-10-02",
          extra: 1,
        }),
      ).map((issue) => issue.code),
    ).toEqual(["unrecognized_keys"]);
    expect(
      issues(setFeatureRequestSchema.safeParse({ enabled: true, extra: 1 })).map(
        (issue) => issue.code,
      ),
    ).toEqual(["unrecognized_keys"]);
  });

  it("defaults a missing screen groupBy and leaves an omitted export groupBy absent", () => {
    expect(
      reportDailyTakingsQuerySchema.parse({ from: "2026-10-01", to: "2026-10-02" }).groupBy,
    ).toBe("day");
    expect(
      reportPeriodSummaryQuerySchema.parse({ from: "2026-10-01", to: "2026-10-02" }).groupBy,
    ).toBe("month");
    expect(
      reportExportRequestSchema.parse({
        report: "daily_takings",
        from: "2026-10-01",
        to: "2026-10-02",
        format: "csv",
        language: "ar",
      }),
    ).not.toHaveProperty("groupBy");
  });

  it("defaults a missing report cursor limit to 50 and does not invent a cursor", () => {
    expect(reportOutstandingQuerySchema.parse({ from: "2026-10-01", to: "2026-10-02" })).toEqual({
      from: "2026-10-01",
      to: "2026-10-02",
      limit: 50,
    });
  });
});

describe("366 and 1096 day bounds", () => {
  it("accepts 366 days and names 367 validation.rangeTooLong", () => {
    expect(
      reportDailyTakingsQuerySchema.parse({ from: "2024-01-01", to: "2024-12-31" }).groupBy,
    ).toBe("day");
    expect(
      issues(reportDailyTakingsQuerySchema.safeParse({ from: "2024-01-01", to: "2025-01-01" })).map(
        (issue) => ({ path: issue.path, code: issue.code, message: issue.message }),
      ),
    ).toEqual([{ path: ["to"], code: "custom", message: "validation.rangeTooLong" }]);
  });

  it("accepts a 1096-day export and names 1097 with the same key", () => {
    expect(
      reportExportRequestSchema.safeParse({
        report: "daily_takings",
        from: "2024-01-01",
        to: "2026-12-31",
        format: "csv",
        language: "ar",
      }).success,
    ).toBe(true);
    expect(
      issues(
        reportExportRequestSchema.safeParse({
          report: "daily_takings",
          from: "2024-01-01",
          to: "2027-01-01",
          format: "csv",
          language: "ar",
        }),
      ).map((issue) => ({ path: issue.path, code: issue.code, message: issue.message })),
    ).toEqual([{ path: ["to"], code: "custom", message: "validation.rangeTooLong" }]);
  });
});
