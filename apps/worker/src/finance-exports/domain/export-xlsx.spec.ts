import { REPORT_EXPORT_COLUMNS, REPORT_IDS } from "@eyadex/contracts/finance-reports";
import { describe, expect, it } from "vitest";

import "./__tests__/export-xlsx-guards.ts";
import "./__tests__/export-xlsx-values.ts";
import { date, money, text } from "./__tests__/export-csv-rows.ts";
import { filled, refused, sheetOf, success, written } from "./__tests__/export-xlsx-run.ts";
import { readXlsx } from "./__tests__/export-xlsx-xml.ts";

const LEAK = "LEAK-marker";

describe("writeReportXlsx", () => {
  it.each(
    REPORT_IDS.flatMap((report) =>
      (["ar", "en"] as const).map((language) => [report, language] as const),
    ),
  )(
    "%s %s headers follow REPORT_EXPORT_COLUMNS, and an empty export still has one sheet",
    async (report, language) => {
      const result = await success(written(report, [], language));
      expect(result.rowCount).toBe(0);
      const sheet = await sheetOf(report, [], language);
      expect(sheet.rows).toHaveLength(1);
      expect(sheet.rows[0]?.map((cell) => cell.value)).toEqual(
        REPORT_EXPORT_COLUMNS[report].map((column) => column.header[language]),
      );
      expect(sheet.rows[0]?.every((cell) => cell.kind === "text")).toBe(true);
      expect(sheet.formulaMarkup).toBe(false);
      expect(sheet.hyperlinkMarkup).toBe(false);
    },
  );

  it("writes one report in contract order, with each row's own currency and exponent", async () => {
    const sheet = await sheetOf("daily_takings", [
      filled("daily_takings", {
        period: date("2026-10"),
        branchName: text("branch-token, one"),
        method: text("cash-token"),
        currency: text("KWD"),
        netMinor: money(-1n, 3),
      }),
      filled("daily_takings", {
        period: date("2026-11-02"),
        currency: text("SAR"),
        inMinor: money(1250n, 2),
      }),
    ]);
    expect(sheet.rows[0]?.map((cell) => cell.value)).toEqual(
      REPORT_EXPORT_COLUMNS.daily_takings.map((column) => column.header.en),
    );
    expect(sheet.rows[1]?.map((cell) => cell.value)).toEqual([
      "2026-10",
      "branch-token, one",
      "cash-token",
      "12.500",
      "12.500",
      "-0.001",
      "KWD",
    ]);
    expect(sheet.rows[2]?.[3]).toMatchObject({ kind: "text", value: "12.50", format: "@" });
    expect(sheet.rows[2]?.[6]?.value).toBe("SAR");
    expect(sheet.rows[1]?.[6]?.value).not.toBe(sheet.rows[2]?.[6]?.value);
    expect(sheet.rows[1]?.[5]).toMatchObject({ kind: "text", value: "-0.001" });
    expect(sheet.worksheetFiles).toBe(1);
  });

  it("repeats the same cells without depending on ZIP bytes staying identical", async () => {
    const input = [
      filled("own_summary", {
        billedMinor: money(-1n, 3),
        currency: text("KWD"),
        period: date("2026-10"),
      }),
    ];
    const first = await success(written("own_summary", input));
    const second = await success(written("own_summary", input));
    expect(valuesOf(first.bytes)).toEqual(valuesOf(second.bytes));
  });

  it("refuses a missing column, a bad language and a non-array without bytes", async () => {
    await refused(written("own_summary", [{ period: date("2026-10") }]), LEAK);
    await refused(written("own_summary" as never, [], "fr" as never), LEAK);
    await refused(written("own_summary", null as never), LEAK);
    await refused(written("not-a-report" as never, []), LEAK);
  });
});

function valuesOf(bytes: Uint8Array): string[][] {
  return readXlsx(bytes).rows.map((line) => line.map((cell) => cell.value));
}
