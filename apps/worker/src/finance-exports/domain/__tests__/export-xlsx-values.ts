import { REPORT_EXPORT_COLUMNS } from "@eyadex/contracts/finance-reports";
import { formatSignedMinor } from "@eyadex/contracts/money";
import { describe, expect, it } from "vitest";

import { count, money, row, text } from "./export-csv-rows.ts";
import type { XlsxCell } from "./export-xlsx-xml.ts";
import { refused, sheetOf, written } from "./export-xlsx-run.ts";

const HUGE = "123456789012345678901234";
const NINETEEN = "1234567890123456789";
const LEAK = "LEAK-marker";

function at(cells: readonly XlsxCell[], key: string): XlsxCell {
  const index = REPORT_EXPORT_COLUMNS.own_summary.findIndex((column) => column.key === key);
  const cell = cells[index];
  if (cell === undefined) throw new Error(`missing ${key}`);
  return cell;
}

describe("writeReportXlsx amounts", () => {
  it("keeps first, middle, and last rows aligned on a many-row sheet", async () => {
    const total = 64;
    const rows = Array.from({ length: total }, (_, index) =>
      row("by_service", {
        name: text(`service-${index}`),
        lineCount: count(2),
        quantity: count(3),
        amountMinor: money(12500n, 3),
        currency: text("KWD"),
      }),
    );
    const sheet = await sheetOf("by_service", rows);
    const keys = REPORT_EXPORT_COLUMNS.by_service.map((column) => column.key);
    const name = keys.indexOf("name");
    const lineCount = keys.indexOf("lineCount");
    const quantity = keys.indexOf("quantity");
    const amount = keys.indexOf("amountMinor");
    const currency = keys.indexOf("currency");
    expect(sheet.rows).toHaveLength(total + 1);
    expect(sheet.formulaMarkup).toBe(false);
    for (const index of [0, 31, total - 1]) {
      const body = sheet.rows[index + 1];
      expect(body?.[name]).toMatchObject({ kind: "text", value: `service-${index}` });
      expect(body?.[lineCount]).toMatchObject({ kind: "number", value: "2" });
      expect(body?.[quantity]).toMatchObject({ kind: "number", value: "3" });
      expect(body?.[amount]).toMatchObject({ kind: "text", value: "12.500", format: "@" });
      expect(body?.[currency]).toMatchObject({ kind: "text", value: "KWD" });
    }
  });

  it.each([
    ["24-zero", HUGE, 0],
    ["24-negative-zero", `-${HUGE}`, 0],
    ["24-fils", HUGE, 3],
    ["24-negative-fils", `-${HUGE}`, 3],
    ["19-zero", NINETEEN, 0],
    ["19-negative", `-${NINETEEN}`, 0],
    ["fraction", "-1", 3],
    ["zero-fils", "0", 2],
    ["zero-exponent", "0", 0],
    ["padded-zero", "0", 3],
  ] as const)(
    "writes %s as an exact text cell, not a number or a formula",
    async (_id, minor, exponent) => {
      const expected = formatSignedMinor(minor, exponent);
      const sheet = await sheetOf("own_summary", [
        row("own_summary", { billedMinor: money(minor, exponent) }),
      ]);
      const cell = at(sheet.rows[1] ?? [], "billedMinor");
      expect(cell.kind).toBe("text");
      expect(cell.value).toBe(expected);
      expect(cell.value.startsWith("'")).toBe(false);
      expect(cell.format).toBe("@");
      expect(sheet.formulaMarkup).toBe(false);
    },
  );

  it("accepts a minor amount CSV would refuse, still as exact text", async () => {
    const minor = "1000000000000001";
    const sheet = await sheetOf("own_summary", [
      row("own_summary", { billedMinor: money(minor, 0), currency: text("KWD") }),
    ]);
    const cell = at(sheet.rows[1] ?? [], "billedMinor");
    expect(cell).toMatchObject({ kind: "text", value: minor, format: "@" });
  });

  it("types a count as a number after validation and does not cap a safe wide count", async () => {
    const wide = 1000000000000001n;
    const sheet = await sheetOf("by_service", [
      row("by_service", {
        lineCount: count("15"),
        quantity: count(wide),
        amountMinor: money(0n, 3),
      }),
    ]);
    const keys = REPORT_EXPORT_COLUMNS.by_service.map((column) => column.key);
    const line = sheet.rows[1]?.[keys.indexOf("lineCount")];
    const quantity = sheet.rows[1]?.[keys.indexOf("quantity")];
    const amount = sheet.rows[1]?.[keys.indexOf("amountMinor")];
    expect(line).toMatchObject({ kind: "number", value: "15" });
    expect(quantity).toMatchObject({ kind: "number", value: wide.toString() });
    expect(amount).toMatchObject({ kind: "text", value: "0.000", format: "@" });
    expect(line?.format).not.toBe("@");
  });

  it("refuses a count that a JS number cannot preserve, with no bytes", async () => {
    await refused(
      written("by_service", [
        row("by_service", {
          quantity: count(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
          name: text(LEAK),
        }),
      ]),
      LEAK,
    );
  });
});
