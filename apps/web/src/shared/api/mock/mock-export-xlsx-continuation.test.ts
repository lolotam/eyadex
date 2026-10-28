import { expect, it } from "vitest";
import { prepareReportExport } from "./mock-export-cells";
import { date, row } from "./mock-export-fixtures.test-kit";
import { reportSheetXmls, XLSX_DATA_ROWS_PER_SHEET } from "./mock-export-sheet-xml";
import { encodePreparedXlsx } from "./mock-export-xlsx";
import { cellValues, elements, parseXml, readXlsx } from "./mock-export-xlsx.test-kit";

it("uses Excel's full format capacity, not a business row cap", () => {
  expect(XLSX_DATA_ROWS_PER_SHEET).toBe(1_048_575);
});

it.each([0, 1, 3, 4, 6, 7])("sheet continuation retains all %s rows exactly once", async (size) => {
  const prepared = prepareReportExport({ report: "own_summary", language: "ar",
    rows: Array.from({ length: size }, (_, i) => row("own_summary", { period: date(`synthetic-${i}`) })) });
  if (!prepared.ok) throw new Error("Invalid synthetic fixture");
  // The same split helper serves the real writer; only this internal seam injects a small limit.
  const artifact = await readXlsx(await encodePreparedXlsx(prepared, true, 3));
  expect(artifact.rowCount).toBe(size);
  expect(artifact.sheets).toHaveLength(Math.max(1, Math.ceil(size / 3)));
  const actual: string[] = [];
  for (const [index, sheet] of artifact.sheets.entries()) {
    const values = cellValues(sheet);
    expect(values[0]).toStrictEqual(["الشهر", "المبلغ", "العملة"]);
    expect(values).toHaveLength(1 + Math.min(3, Math.max(0, size - index * 3)));
    expect(elements(sheet, "sheetView")[0]?.getAttribute("rightToLeft")).toBe("1");
    for (const [rowIndex, record] of elements(sheet, "row").entries()) {
      expect(record.getAttribute("r")).toBe(String(rowIndex + 1));
      expect(elements(record, "c").map((cell) => cell.getAttribute("r")))
        .toStrictEqual([`A${rowIndex + 1}`, `B${rowIndex + 1}`, `C${rowIndex + 1}`]);
    }
    actual.push(...values.slice(1).map((cells) => cells[0] ?? "missing"));
  }
  expect(actual).toStrictEqual(Array.from({ length: size }, (_, i) => `synthetic-${i}`));
});

it("the public default split helper uses the same header-only behavior", () => {
  const documents = [...reportSheetXmls(["Synthetic"], [], false)].map(parseXml);
  expect(documents).toHaveLength(1);
  const document = documents[0];
  if (!document) throw new Error("Missing document");
  expect(cellValues(document)).toStrictEqual([["Synthetic"]]);
});

it.each([0, -1, 1.5, NaN, Infinity, 1_048_576])("refuses invalid injected format limit %s", async (limit) => {
  const prepared = prepareReportExport({ report: "own_summary", language: "en", rows: [] });
  if (!prepared.ok) throw new Error("Invalid synthetic fixture");
  expect(await encodePreparedXlsx(prepared, false, limit))
    .toStrictEqual({ ok: false, code: "export_value_invalid" });
});

it("invalid XML on a later continuation sheet yields no partial ZIP", async () => {
  const prepared = prepareReportExport({ report: "own_summary", language: "en", rows: [
    row("own_summary"), row("own_summary"),
    row("own_summary", { period: date("synthetic-private-marker\u0001") }),
  ] });
  if (!prepared.ok) throw new Error("Invalid synthetic fixture");
  expect(await encodePreparedXlsx(prepared, false, 2))
    .toStrictEqual({ ok: false, code: "export_value_invalid" });
});