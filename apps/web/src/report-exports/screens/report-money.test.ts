import { expect, it } from "vitest";
import { formatReportMinor, sumMinor } from "./report-money";
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
  expect(formatReportMinor("123456789012345678901", 3, "en")).toBe(
    "123,456,789,012,345,678.901",
  );
  expect(sumMinor(["9007199254740993", "1", "-4"])).toBe("9007199254740990");
});

it("defaults to the current clinic month up to today in the clinic's zone", () => {
  // 21:30 UTC on 31 Oct is already 1 Nov in Kuwait.
  const now = new Date("2026-10-31T21:30:00Z");
  expect(defaultReportRange("Asia/Kuwait", now)).toEqual({ from: "2026-11-01", to: "2026-11-01" });
  expect(defaultReportRange("UTC", now)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
});
