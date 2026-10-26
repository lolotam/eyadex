import { REPORT_EXPORT_COLUMNS } from "@eyadex/contracts/finance-reports";
import { describe, expect, it } from "vitest";

import type { ExportCell, ReportCsvResult } from "../export-csv.ts";
import {
  FITS,
  OVER,
  count,
  date,
  money,
  parseCsv,
  row,
  success,
  text,
  written,
} from "./export-csv-rows.ts";

const LEAK = "LEAK-marker";

function captured(run: () => ReportCsvResult): ReportCsvResult | undefined {
  let result: ReportCsvResult | undefined;
  expect(() => {
    result = run();
  }).not.toThrow();
  return result;
}

function refused(result: ReportCsvResult | undefined) {
  expect(result).toEqual({ ok: false, code: "export_value_invalid" });
  expect(result).not.toHaveProperty("bytes");
  expect(JSON.stringify(result)).not.toContain(LEAK);
  expect(JSON.stringify(result)).not.toContain("-3.000");
  expect(JSON.stringify(result)).not.toContain(String(Number.MAX_SAFE_INTEGER));
}

describe("writeReportCsv precision", () => {
  it.each([
    [0, FITS, true, FITS.toString()],
    [0, -FITS, true, `-${FITS.toString()}`],
    [2, FITS, true, "9999999999999.99"],
    [2, -FITS, true, "-9999999999999.99"],
    [3, FITS, true, "999999999999.999"],
    [3, -FITS, true, "-999999999999.999"],
    [0, OVER, false, ""],
    [0, -OVER, false, ""],
    [2, OVER, false, ""],
    [2, -OVER, false, ""],
    [3, OVER, false, ""],
    [3, -OVER, false, ""],
  ] as const)("exponent %s minor boundary allowed=%s", (exponent, minor, allowed, cell) => {
    const result = written("own_summary", [
      row("own_summary", { billedMinor: money(1n, exponent), currency: text("KWD") }),
      row("own_summary", {
        billedMinor: money(minor, exponent),
        currency: text("SECRET-NAME"),
        period: date("2026-10"),
      }),
    ]);
    if (allowed) {
      const parsed = parseCsv(success(result).bytes);
      expect(parsed[2]?.[1]).toBe(cell);
      expect(parsed[2]?.[1]?.startsWith("'")).toBe(false);
      return;
    }
    expect(result).toEqual({ ok: false, code: "export_amount_too_large" });
    expect(result).not.toHaveProperty("bytes");
    expect(JSON.stringify(result)).not.toContain(OVER.toString());
    expect(JSON.stringify(result)).not.toContain("SECRET-NAME");
  });

  it("counts significant digits without sign, dot, leading zeros, or fixed currency pad zeros", () => {
    const padded = parseCsv(
      success(
        written("own_summary", [
          row("own_summary", { billedMinor: money(1000n, 3) }),
          row("own_summary", { billedMinor: money(1n, 3) }),
          row("own_summary", { billedMinor: money(0n, 2) }),
          row("own_summary", { billedMinor: money(999999999999999000n, 3) }),
          row("own_summary", { billedMinor: money(1000000000000000000n, 3) }),
        ]),
      ).bytes,
    );
    expect(padded[1]?.[1]).toBe("1.000");
    expect(padded[2]?.[1]).toBe("0.001");
    expect(padded[3]?.[1]).toBe("0.00");
    expect(padded[4]?.[1]).toBe("999999999999999.000");
    expect(padded[5]?.[1]).toBe("1000000000000000.000");
    const subunit = written("own_summary", [
      row("own_summary", {
        billedMinor: money(999999999999999001n, 3),
        currency: text("do-not-leak"),
      }),
    ]);
    expect(subunit).toEqual({ ok: false, code: "export_amount_too_large" });
    expect(JSON.stringify(subunit)).not.toContain("999999999999999001");
    expect(JSON.stringify(subunit)).not.toContain("do-not-leak");
    const exponentTwo = written("own_summary", [
      row("own_summary", { billedMinor: money(100000000000000100n, 2) }),
    ]);
    expect(exponentTwo).toEqual({ ok: false, code: "export_amount_too_large" });
  });

  it.each([
    ["huge", Number.MAX_SAFE_INTEGER],
    ["one", 1],
    ["four", 4],
    ["negative", -1],
    ["fractional", 1.5],
    ["nan", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
  ] as const)(
    "rejects exponent %s before formatting, with no bytes and no throw",
    (_id, exponent) => {
      refused(
        captured(() =>
          written("own_summary", [
            row("own_summary", { billedMinor: money(1n, exponent), currency: text(LEAK) }),
          ]),
        ),
      );
    },
  );

  it.each<[string, ExportCell]>([
    ["major-leak-text", { kind: "money", minor: "-3.000-LEAK", exponent: 3 }],
    ["js-number", { kind: "money", minor: 12500 as never, exponent: 3 }],
    ["negative-zero", { kind: "money", minor: "-0", exponent: 3 }],
    ["leading-zero", { kind: "money", minor: "01", exponent: 3 }],
    ["exponent-notation", { kind: "money", minor: "1e2", exponent: 3 }],
    ["formula", { kind: "money", minor: "=1+1", exponent: 3 }],
    ["decimal-text", { kind: "money", minor: "-3.000", exponent: 3 }],
    ["text-kind", { kind: "text", value: "=1+1" }],
  ])("rejects money boundary %s in the money column", (_id, bad) => {
    refused(
      captured(() =>
        written("by_service", [row("by_service", { amountMinor: bad, name: text(LEAK) })]),
      ),
    );
  });

  it.each([
    ["negative-number", "by_service", "quantity", -1],
    ["fractional", "by_service", "quantity", 1.5],
    ["unsafe-integer", "period_summary", "voidCount", Number.MAX_SAFE_INTEGER + 1],
    ["nan", "by_service", "quantity", Number.NaN],
    ["infinity", "period_summary", "voidCount", Number.POSITIVE_INFINITY],
    ["leading-zero", "by_service", "quantity", "01"],
    ["decimal-string", "by_service", "quantity", "1.5"],
    ["formula-string", "period_summary", "voidCount", "=1"],
    ["negative-bigint", "by_service", "quantity", -1n],
  ] as const)("rejects count %s on %s", (_id, report, column, value) => {
    const nameColumn = report === "period_summary" ? "branchName" : "name";
    refused(
      captured(() =>
        written(report, [row(report, { [column]: count(value), [nameColumn]: text(LEAK) })]),
      ),
    );
  });

  it.each([
    ["canonical-string", "by_service", "lineCount", "15", "15"],
    ["safe-integer", "period_summary", "voidCount", 4, "4"],
    ["bigint", "by_service", "quantity", 4n, "4"],
  ] as const)("accepts count %s", (_id, report, column, value, cell) => {
    const parsed = parseCsv(
      success(written(report, [row(report, { [column]: count(value) })])).bytes,
    );
    const index = REPORT_EXPORT_COLUMNS[report].findIndex((item) => item.key === column);
    expect(parsed[1]?.[index]).toBe(cell);
  });

  it("refuses a monetary bigint that a JS number cannot preserve", () => {
    const huge = 1000000000000000000000001n;
    expect(written("own_summary", [row("own_summary", { billedMinor: money(huge, 0) })])).toEqual({
      ok: false,
      code: "export_amount_too_large",
    });
  });
});
