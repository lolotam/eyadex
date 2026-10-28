import { REPORT_EXPORT_COLUMNS, type ReportId } from "@eyadex/contracts/finance-reports";
import { describe, expect, it } from "vitest";
import { artifact, count, date, money, refused, row, text } from "./mock-export-fixtures.test-kit";

const reports = Object.keys(REPORT_EXPORT_COLUMNS).filter((key): key is ReportId =>
  Object.hasOwn(REPORT_EXPORT_COLUMNS, key),
);

describe("standalone CSV artifacts", () => {
  it.each(reports)(
    "writes catalogue columns only, in order, for %s in both languages",
    (report) => {
      const cells = row(report, { extra: text("must-not-export") });
      for (const language of ["ar", "en"] as const) {
        const result = artifact(report, [cells], language);
        expect(result.rowCount).toBe(1);
        expect(result.records[0]).toStrictEqual(
          REPORT_EXPORT_COLUMNS[report].map((c) => c.header[language]),
        );
        expect(result.records[1]).toStrictEqual(
          REPORT_EXPORT_COLUMNS[report].map((c) =>
            c.kind === "money"
              ? "12.500"
              : c.kind === "count"
                ? "2"
                : c.kind === "date"
                  ? "2026-10-28"
                  : `sample-${c.key}`,
          ),
        );
        expect(result.body).not.toContain("must-not-export");
      }
    },
  );

  it.each(["=", "+", "-", "@", "\t", "\n", "\r"])(
    "formula guard prefixes first code unit %j in text/date/currency",
    (trigger) => {
      const value = `${trigger}synthetic`;
      const result = artifact("daily_takings", [
        row("daily_takings", {
          period: date(value),
          branchName: text(value),
          method: text(value),
          currency: text(value),
          netMinor: money("-1"),
        }),
      ]);
      expect(result.records[1]).toStrictEqual([
        `'${value}`,
        `'${value}`,
        `'${value}`,
        "12.500",
        "12.500",
        "-0.001",
        `'${value}`,
      ]);
    },
  );

  it.each(["=", "+", "-", "@", "\t", "\n", "\r"])(
    "does not guard a trigger %j in the second position",
    (trigger) => {
      const value = `x${trigger}synthetic`;
      expect(
        artifact("own_summary", [
          row("own_summary", { period: date(value), currency: text(value) }),
        ]).records[1],
      ).toStrictEqual([value, "12.500", value]);
    },
  );

  it("roundtrips untrimmed whitespace, null, comma, doubled quote, CR and LF", () => {
    const values = ["  =second  ", null, "a,b", 'a"b', "a\rb", "a\nb", "a\r\nb", "", " عربي "];
    const result = artifact(
      "own_summary",
      values.map((value) => row("own_summary", { currency: text(value) })),
    );
    expect(result.records.slice(1).map((record) => record[2])).toStrictEqual(
      values.map((value) => value ?? ""),
    );
    expect(result.body).toContain('"a""b"');
    expect(result.body).toContain('"a,b"');
  });

  it.each([
    [0, "12500", "12500"],
    [0, "-12500", "-12500"],
    [0, 0n, "0"],
    [2, 12500n, "125.00"],
    [2, -1n, "-0.01"],
    [2, "0", "0.00"],
    [3, "12500", "12.500"],
    [3, "-1", "-0.001"],
    [3, 0n, "0.000"],
  ] as const)("formats exact minor value %s / %s", (exponent, minor, expected) => {
    expect(
      artifact("own_summary", [row("own_summary", { billedMinor: money(minor, exponent) })])
        .records[1]?.[1],
    ).toBe(expected);
  });

  it.each([0, 2, 3])("precision guard refuses 16 significant digits at exponent %s", (exponent) => {
    for (const minor of [1000000000000001n, -1000000000000001n]) {
      refused(
        {
          report: "own_summary",
          language: "en",
          rows: [
            row("own_summary"),
            row("own_summary", {
              billedMinor: money(minor, exponent),
              currency: text("synthetic-private-marker"),
            }),
          ],
        },
        "export_amount_too_large",
      );
    }
  });

  it.each([
    [0, 999999999999999n, "999999999999999"],
    [0, -999999999999999n, "-999999999999999"],
    [2, 999999999999999n, "9999999999999.99"],
    [2, -999999999999999n, "-9999999999999.99"],
    [3, 999999999999999n, "999999999999.999"],
    [3, -999999999999999n, "-999999999999.999"],
    [3, 999999999999999000n, "999999999999999.000"],
    [3, 1000000000000000000n, "1000000000000000.000"],
    [3, -999999999999999000n, "-999999999999999.000"],
    [3, 1n, "0.001"],
    [2, 0n, "0.00"],
  ] as const)("preserves allowed significant digits %s / %s", (exponent, minor, expected) => {
    expect(
      artifact("own_summary", [row("own_summary", { billedMinor: money(minor, exponent) })])
        .records[1]?.[1],
    ).toBe(expected);
  });

  it("precision guard does not discard nonzero subunits after trailing padding", () => {
    for (const minor of [999999999999999001n, -999999999999999001n]) {
      refused(
        {
          report: "own_summary",
          language: "ar",
          rows: [row("own_summary", { billedMinor: money(minor) })],
        },
        "export_amount_too_large",
      );
    }
  });

  it("counts and arbitrary text are not subject to the monetary precision guard", () => {
    const huge = "123456789012345678901234567890123456789";
    const result = artifact("by_service", [
      row("by_service", {
        name: text(huge),
        lineCount: count(huge),
        quantity: count(BigInt(huge)),
      }),
    ]);
    expect(result.records[1]?.slice(0, 3)).toStrictEqual([huge, huge, huge]);
  });

  it.each([0, 4n, "15", Number.MAX_SAFE_INTEGER])("preserves accepted count %s", (value) => {
    expect(
      artifact("by_service", [row("by_service", { quantity: count(value) })]).records[1]?.[2],
    ).toBe(value.toString());
  });

  it("writes a BOM and only the header for an empty export", () => {
    const result = artifact("own_summary", [], "ar");
    expect(result.rowCount).toBe(0);
    expect(result.records).toStrictEqual([["الشهر", "المبلغ", "العملة"]]);
    expect(result.body).toBe("الشهر,المبلغ,العملة\r\n");
  });

  it("keeps every supplied row beyond a usual 100-row report page", () => {
    const result = artifact(
      "own_summary",
      Array.from({ length: 251 }, (_, index) =>
        row("own_summary", { period: date(`synthetic-${index}`) }),
      ),
    );
    expect(result.rowCount).toBe(251);
    expect(result.records).toHaveLength(252);
    expect(result.records.slice(1).map((record) => record[0])).toStrictEqual(
      Array.from({ length: 251 }, (_, index) => `synthetic-${index}`),
    );
  });
});
