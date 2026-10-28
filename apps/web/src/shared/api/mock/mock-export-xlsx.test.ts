import { describe, expect, it } from "vitest";
import { REPORT_EXPORT_COLUMNS, type ReportId } from "@eyadex/contracts/finance-reports";
import { count, date, money, row, text } from "./mock-export-fixtures.test-kit";
import { cellValues, elements, xlsxArtifact, xlsxRefused } from "./mock-export-xlsx.test-kit";

const reports = Object.keys(REPORT_EXPORT_COLUMNS).filter((key): key is ReportId =>
  Object.hasOwn(REPORT_EXPORT_COLUMNS, key),
);

describe("genuine browser XLSX artifacts", () => {
  it.each(reports)("writes ordered catalogue headers/cells and RTL for %s", async (report) => {
    for (const language of ["ar", "en"] as const) {
      const artifact = await xlsxArtifact(report, [row(report, { extra: text("must-not-export") })], language);
      expect(artifact.rowCount).toBe(1);
      expect(artifact.sheets).toHaveLength(1);
      const sheet = artifact.sheets[0];
      if (!sheet) throw new Error("Missing sheet");
      expect(elements(sheet, "sheetView")[0]?.getAttribute("rightToLeft"))
        .toBe(language === "ar" ? "1" : "0");
      expect(cellValues(sheet)).toStrictEqual([
        REPORT_EXPORT_COLUMNS[report].map((column) => column.header[language]),
        REPORT_EXPORT_COLUMNS[report].map((column) => column.kind === "money" ? "12.500"
          : column.kind === "count" ? "2" : column.kind === "date" ? "2026-10-28" : `sample-${column.key}`),
      ]);
      const records = elements(sheet, "row");
      expect(records.map((record) => record.getAttribute("r"))).toStrictEqual(["1", "2"]);
      for (const [index, record] of records.entries()) {
        for (const [column, cell] of elements(record, "c").entries()) {
          expect(cell.getAttribute("r")).toBe(`${String.fromCharCode(65 + column)}${index + 1}`);
          const numeric = index === 1 && REPORT_EXPORT_COLUMNS[report][column]?.kind === "count";
          expect(cell.getAttribute("t")).toBe(numeric ? "n" : "inlineStr");
          expect(cell.getAttribute("s")).toBe(numeric ? null : "1");
          if (!numeric) expect(elements(cell, "t")[0]?.getAttributeNS("http://www.w3.org/XML/1998/namespace", "space"))
            .toBe("preserve");
        }
      }
      expect([...artifact.parts.values()].join("")).not.toContain("must-not-export");
    }
  });

  it.each([
    [0, "12500", "12500"], [0, "-12500", "-12500"], [0, 0n, "0"],
    [2, 12500n, "125.00"], [2, -1n, "-0.01"], [2, "0", "0.00"],
    [3, "12500", "12.500"], [3, "-1", "-0.001"], [3, 0n, "0.000"],
    [3, "999999999999999001", "999999999999999.001"],
    [3, "-999999999999999001", "-999999999999999.001"],
    [2, "12345678901234567890123456789", "123456789012345678901234567.89"],
  ] as const)("stores exact money as styled inline text %s/%s", async (exponent, minor, expected) => {
    const artifact = await xlsxArtifact("own_summary", [row("own_summary", { billedMinor: money(minor, exponent) })]);
    const sheet = artifact.sheets[0];
    if (!sheet) throw new Error("Missing sheet");
    const cell = elements(sheet, "c").find((item) => item.getAttribute("r") === "B2");
    expect(cell?.getAttribute("t")).toBe("inlineStr");
    expect(cell?.getAttribute("s")).toBe("1");
    expect(cell?.textContent).toBe(expected);
    expect(cell && elements(cell, "v")).toStrictEqual([]);
    expect(cell && elements(cell, "f")).toStrictEqual([]);
  });

  it.each([0, 4n, "15", Number.MAX_SAFE_INTEGER, BigInt(Number.MAX_SAFE_INTEGER)])
    ("stores safe count %s without rounding", async (value) => {
      const artifact = await xlsxArtifact("by_service", [row("by_service", { quantity: count(value) })]);
      const sheet = artifact.sheets[0];
      if (!sheet) throw new Error("Missing sheet");
      const cell = elements(sheet, "c").find((item) => item.getAttribute("r") === "C2");
      expect(cell?.getAttribute("t")).toBe("n");
      expect(cell?.textContent).toBe(value.toString());
      expect(cell && elements(cell, "is")).toStrictEqual([]);
    });

  it.each(["9007199254740992", 9007199254740992n, -1n, "01", 1.5, Number.MAX_SAFE_INTEGER + 1])
    ("refuses unsafe count %s with no artifact", async (value) => {
      await xlsxRefused({ report: "by_service", language: "en", rows: [row("by_service"), row("by_service", { quantity: count(value) })] });
    });

  it.each(["=", "+", "-", "@", "\t", "\n", "\r"])
    ("reuses prepared formula guard for text/date/currency %j", async (trigger) => {
      const value = `${trigger}synthetic`;
      const artifact = await xlsxArtifact("own_summary", [row("own_summary", { period: date(value), currency: text(value) })]);
      const sheet = artifact.sheets[0];
      if (!sheet) throw new Error("Missing sheet");
      expect(cellValues(sheet)[1]).toStrictEqual([`'${value}`, "12.500", `'${value}`]);
    });

  it("roundtrips XML escapes, Xstring literals, whitespace and supplementary Unicode", async () => {
    const values = ["&<>\"'", " a\rb\nc\td ", "  =second  ", "x=second", " عربي 😀 𐀀 ",
      "_x0041_", "_x000D_", "_x005F_", "_xAbCd_", "_x0041__x0042_", "_x005F_x0041_", null, ""];
    const artifact = await xlsxArtifact("own_summary", values.map((value) => row("own_summary", { currency: text(value) })));
    const sheet = artifact.sheets[0];
    if (!sheet) throw new Error("Missing sheet");
    // DOM resolves XML entities, not OOXML Xstring escapes; inspect exact stored text independently.
    expect(cellValues(sheet).slice(1).map((cells) => cells[2])).toStrictEqual([
      "&<>\"'", " a\rb\nc\td ", "  =second  ", "x=second", " عربي 😀 𐀀 ",
      "_x005F_x0041_", "_x005F_x000D_", "_x005F_x005F_", "_x005F_xAbCd_",
      "_x005F_x0041__x005F_x0042_", "_x005F_x005F_x0041_", "", "",
    ]);
    const source = artifact.parts.get("xl/worksheets/sheet1.xml");
    expect(source).toContain("&amp;&lt;&gt;");
    expect(source).toContain("a&#13;b\nc\td");
    expect(source).not.toContain("_x005F_x005F_x0041_");
  });

  it.each([0, 1, 8, 11, 12, 14, 31, 0xfffe, 0xffff, 0xd800, 0xdc00])
    ("XML invalid-codepoint guard refuses U+%s before exposing bytes", async (code) => {
      await xlsxRefused({ report: "own_summary", language: "en", rows: [row("own_summary"),
        row("own_summary", { currency: text(`synthetic-private-marker${String.fromCharCode(code)}`) })] });
    });

  it("validates header XML as well as date text", async () => {
    const header = REPORT_EXPORT_COLUMNS.own_summary[0]?.header;
    if (!header) throw new Error("Missing header");
    const previous = header.en;
    header.en = "synthetic\u0001";
    try { await xlsxRefused({ report: "own_summary", language: "en", rows: [] }); }
    finally { header.en = previous; }
    await xlsxRefused({ report: "own_summary", language: "en", rows: [row("own_summary", { period: date("synthetic\ud800") })] });
  });

  it.each([null, {}, { report: "toString", language: "en", rows: [] },
    { report: "own_summary", language: "fr", rows: [] },
    { report: "own_summary", language: "en", rows: [{}] },
    { report: "own_summary", language: "en", rows: [Object.create(row("own_summary"))] },
    { report: "own_summary", language: "en", rows: [row("own_summary", { billedMinor: money("-0") })] },
  ])("refuses malformed input without raw values %j", async (input) => xlsxRefused(input));

  it("keeps all rows beyond a normal report page and emits a header-only empty sheet", async () => {
    const empty = await xlsxArtifact("own_summary", [], "ar");
    expect(empty.rowCount).toBe(0);
    expect(empty.sheets).toHaveLength(1);
    const first = empty.sheets[0];
    if (!first) throw new Error("Missing empty sheet");
    expect(cellValues(first)).toStrictEqual([["الشهر", "المبلغ", "العملة"]]);
    const artifact = await xlsxArtifact("own_summary", Array.from({ length: 251 }, (_, i) => row("own_summary", { period: date(`synthetic-${i}`) })));
    expect(artifact.rowCount).toBe(251);
    const sheet = artifact.sheets[0];
    if (!sheet) throw new Error("Missing sheet");
    expect(cellValues(sheet).slice(1).map((cells) => cells[0])).toStrictEqual(Array.from({ length: 251 }, (_, i) => `synthetic-${i}`));
  });
});