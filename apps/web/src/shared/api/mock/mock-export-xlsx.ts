import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { prepareReportExport, type PreparedReport } from "./mock-export-cells";
import { reportSheetXmls, workbookParts } from "./mock-export-sheet-xml";

export type ReportXlsxResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly rowCount: number }
  | { readonly ok: false; readonly code: "export_value_invalid" };

/** Internal encoding seam: the public writer never accepts a caller-supplied row cap. */
export async function encodePreparedXlsx(
  prepared: Extract<PreparedReport, { ok: true }>,
  rtl: boolean,
  dataRowsPerSheet?: number,
): Promise<ReportXlsxResult> {
  try {
    // Validate all XML/counts first. Even a later sheet failure exposes no partial ZIP.
    const sheets = [...reportSheetXmls(prepared.header, prepared.rows, rtl, dataRowsPerSheet)];
    const zip = new ZipWriter(new Uint8ArrayWriter(), {
      level: 0, zip64: true, useWebWorkers: false, keepOrder: true,
    });
    for (const [index, xml] of sheets.entries())
      await zip.add(`xl/worksheets/sheet${index + 1}.xml`, new TextReader(xml));
    for (const [name, xml] of workbookParts(sheets.length))
      await zip.add(name, new TextReader(xml));
    const bytes = await zip.close();
    return { ok: true, bytes, rowCount: prepared.rows.length };
  } catch {
    return { ok: false, code: "export_value_invalid" };
  }
}

/** Browser-only in-memory OOXML; money stays exact text, independent of CSV precision. */
export async function writeReportXlsx(input: unknown): Promise<ReportXlsxResult> {
  const prepared = prepareReportExport(input);
  if (!prepared.ok) return prepared;
  try {
    const language = typeof input === "object" && input !== null && "language" in input
      ? input.language : undefined;
    return await encodePreparedXlsx(prepared, language === "ar");
  } catch {
    return { ok: false, code: "export_value_invalid" };
  }
}