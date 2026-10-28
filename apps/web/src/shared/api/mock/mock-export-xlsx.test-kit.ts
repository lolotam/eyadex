import { TextWriter, Uint8ArrayReader, ZipReader } from "@zip.js/zip.js";
import { expect } from "vitest";
import type { ReportId } from "@eyadex/contracts/finance-reports";
import { writeReportXlsx, type ReportXlsxResult } from "./mock-export-xlsx";

export function parseXml(source: string): Document {
  const document = new DOMParser().parseFromString(source, "application/xml");
  expect(document.getElementsByTagName("parsererror")).toHaveLength(0);
  return document;
}

export function elements(document: Document | Element, tag: string): Element[] {
  return Array.from(document.getElementsByTagName(tag));
}

export function cellValues(sheet: Document): string[][] {
  return elements(sheet, "row").map((record) =>
    elements(record, "c").map((cell) => cell.textContent ?? ""),
  );
}

/** Real zip.js readback and independent DOM parsing; no writer XML helpers are used. */
export async function readXlsx(result: ReportXlsxResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected complete synthetic XLSX");
  expect(ArrayBuffer.isView(result.bytes)).toBe(true);
  expect([...result.bytes.subarray(0, 4)]).toStrictEqual([0x50, 0x4b, 0x03, 0x04]);
  const reader = new ZipReader(new Uint8ArrayReader(result.bytes), { useWebWorkers: false });
  const parts = new Map<string, string>();
  try {
    const entries = await reader.getEntries();
    expect(new Set(entries.map((entry) => entry.filename)).size).toBe(entries.length);
    for (const entry of entries) {
      if (entry.directory) throw new Error("Unexpected directory entry");
      expect(entry.zip64).toBe(true);
      expect(entry.compressionMethod).toBe(0);
      const source = await entry.getData(new TextWriter(), {
        useWebWorkers: false,
        checkSignature: true,
      });
      parseXml(source);
      parts.set(entry.filename, source);
    }
  } finally {
    await reader.close();
  }
  const xml = (name: string) => {
    const source = parts.get(name);
    if (source === undefined) throw new Error(`Missing package part ${name}`);
    return parseXml(source);
  };
  const workbook = xml("xl/workbook.xml");
  const relations = elements(xml("xl/_rels/workbook.xml.rels"), "Relationship");
  const types = elements(xml("[Content_Types].xml"), "Override");
  const sheets = elements(workbook, "sheet").map((sheet, index) => {
    const number = index + 1;
    expect(sheet.getAttribute("name")).toBe(`Report ${number}`);
    expect(sheet.getAttribute("sheetId")).toBe(String(number));
    const id = sheet.getAttributeNS(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "id",
    );
    expect(id).toBe(`rId${number}`);
    const relationship = relations.find((rel) => rel.getAttribute("Id") === id);
    expect(relationship?.getAttribute("Target")).toBe(`worksheets/sheet${number}.xml`);
    expect(relationship?.getAttribute("Type")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
    );
    const partName = `/xl/worksheets/sheet${number}.xml`;
    expect(
      types.find((type) => type.getAttribute("PartName") === partName)?.getAttribute("ContentType"),
    ).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml");
    return xml(partName.slice(1));
  });
  expect(sheets.length).toBeGreaterThan(0);
  expect([...parts.keys()].sort()).toStrictEqual(
    [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      ...sheets.map((_, i) => `xl/worksheets/sheet${i + 1}.xml`),
    ].sort(),
  );
  expect(relations).toHaveLength(sheets.length + 1);
  expect(types).toHaveLength(sheets.length + 2);
  const root = elements(xml("_rels/.rels"), "Relationship");
  expect(root).toHaveLength(1);
  expect(root[0]?.getAttribute("Target")).toBe("xl/workbook.xml");
  expect(root[0]?.getAttribute("Type")).toBe(
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  );
  expect(
    relations.find((rel) => rel.getAttribute("Id") === "rIdStyles")?.getAttribute("Target"),
  ).toBe("styles.xml");
  expect(
    types
      .find((type) => type.getAttribute("PartName") === "/xl/workbook.xml")
      ?.getAttribute("ContentType"),
  ).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml");
  expect(
    types
      .find((type) => type.getAttribute("PartName") === "/xl/styles.xml")
      ?.getAttribute("ContentType"),
  ).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml");
  const styles = xml("xl/styles.xml");
  expect(elements(styles, "numFmt")[0]?.getAttribute("formatCode")).toBe("@");
  const textStyle = elements(styles, "cellXfs")[0]?.children[1];
  expect(textStyle?.getAttribute("numFmtId")).toBe("164");
  expect(textStyle?.getAttribute("applyNumberFormat")).toBe("1");
  for (const sheet of sheets) {
    expect(elements(sheet, "f")).toHaveLength(0);
    expect(elements(sheet, "sst")).toHaveLength(0);
  }
  return { ...result, sheets, parts, xml };
}

export async function xlsxArtifact(
  report: ReportId,
  rows: readonly unknown[],
  language: "ar" | "en" = "en",
) {
  return readXlsx(await writeReportXlsx({ report, language, rows }));
}

export async function xlsxRefused(input: unknown) {
  const result = await writeReportXlsx(input);
  expect(result).toStrictEqual({ ok: false, code: "export_value_invalid" });
  expect(result).not.toHaveProperty("bytes");
  expect(JSON.stringify(result)).not.toContain("synthetic-private-marker");
}
