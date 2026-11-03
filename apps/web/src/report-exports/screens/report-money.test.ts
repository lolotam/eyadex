import { expect, it } from "vitest";
import { formatReportMinor, sumMinor } from "./report-money";
import { reportOutstandingQuerySchema } from "@eyadex/contracts/finance-reports";
import { SCREEN_DEFAULT_DAYS } from "./report-catalogue";
import { defaultReportRange } from "./use-report-filters";

it("formats exponent 3 and 2 with grouping, in Latin and Arabic-Indic digits", () => {
  expect(formatReportMinor("1234567", 3, "en")).toBe("1,234.567");
  expect(formatReportMinor("1234567", 2, "en")).toBe("12,345.67");
  expect(formatReportMinor("1234567", 3, "ar")).toBe("١٬٢٣٤٫٥٦٧");
  expect(formatReportMinor("5", 3, "en")).toBe("0.005");
});

it("keeps the minus sign of a signed amount", () => {
  expect(formatReportMinor("-1500", 3, "en")).toBe("-1.500");
  expect(formatReportMinor("-1500", 3, "ar")).toBe("-١٫٥٠٠");
});

it("stays exact beyond Number's safe range", () => {
  expect(formatReportMinor("123456789012345678901", 3, "en")).toBe("123,456,789,012,345,678.901");
  expect(sumMinor(["9007199254740993", "1", "-4"])).toBe("9007199254740990");
});

it("defaults to the current clinic month up to today in the clinic's zone", () => {
  // 21:30 UTC on 31 Oct is already 1 Nov in Kuwait.
  const now = new Date("2026-10-31T21:30:00Z");
  expect(defaultReportRange("Asia/Kuwait", now)).toEqual({ from: "2026-11-01", to: "2026-11-01" });
  expect(defaultReportRange("UTC", now)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
});

it("R5 defaults to the last 365 clinic days through today, inclusive and inside the 366-day cap", () => {
  const days = (r: { from: string; to: string }) =>
    Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000) +
    1;
  // 21:30 UTC on 31 Oct is already 1 Nov in Kuwait, so the window ends on the clinic's today.
  const now = new Date("2026-10-31T21:30:00Z");
  const kuwait = defaultReportRange("Asia/Kuwait", now, 365);
  expect(kuwait).toEqual({ from: "2025-11-02", to: "2026-11-01" });
  expect(defaultReportRange("UTC", now, 365)).toEqual({ from: "2025-11-01", to: "2026-10-31" });
  expect(days(kuwait)).toBe(365);
  // Across a leap day the window is still 365 calendar days, never shifted by the extra day.
  const leap = defaultReportRange("UTC", new Date("2028-03-01T10:00:00Z"), 365);
  expect(leap.to).toBe("2028-03-01");
  expect(days(leap)).toBe(365);
  expect(reportOutstandingQuerySchema.safeParse({ ...leap, limit: 50 }).success).toBe(true);
  // Only R5 opts in: every other report keeps the current clinic month.
  expect(SCREEN_DEFAULT_DAYS).toEqual({ outstanding: 365 });
  expect(defaultReportRange("Asia/Kuwait", now)).toEqual({ from: "2026-11-01", to: "2026-11-01" });
});
