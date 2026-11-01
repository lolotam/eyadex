import { randomBytes, randomUUID } from "node:crypto";
import {
  REPORT_EXPORT_COLUMNS,
  REPORT_IDS,
  type ReportId,
} from "@eyadex/contracts/finance-reports";
import { FieldCipher } from "@eyadex/secrets";
import { describe, expect, it } from "vitest";
import { ExportFileWriter } from "./export-file-writer.ts";
import type { ExportCsvRow } from "./domain/export-cells.ts";
import { row, text, TRIGGERS } from "./domain/__tests__/export-csv-rows.ts";
import { readXlsx } from "./domain/__tests__/export-xlsx-xml.ts";
import { sheetRowXml } from "./domain/export-sheet-xml.ts";

const cipher = new FieldCipher(new Map([[1, randomBytes(32)]]), 1);
async function sheet(
  report: ReportId,
  rows: readonly ExportCsvRow[],
  language: "ar" | "en" = "en",
) {
  const writer = await ExportFileWriter.create(
    { clinicId: randomUUID(), exportId: randomUUID(), attempt: 1, leaseOwner: "sample" },
    {
      report,
      scope: "clinic",
      format: "xlsx",
      requestedBy: randomUUID(),
      userId: randomUUID(),
      params: { from: "2026-01-01", to: "2026-12-31", language, branchIds: [] },
    },
    cipher,
    new AbortController().signal,
  );
  try {
    for (const value of rows) await writer.write(value);
    await writer.finish();
    await writer.file.verify(new AbortController().signal);
    const parts = [];
    for await (const bytes of writer.file.plaintext(new AbortController().signal))
      parts.push(bytes);
    return readXlsx(Buffer.concat(parts));
  } finally {
    await writer.dispose();
  }
}

describe("incremental workbook values", () => {
  it("escapes literal OOXML escape prefixes without converting their contents", () => {
    expect(sheetRowXml([{ kind: "text", value: "_x0041_ _x005F_ ordinary_name" }], 2)).toContain(
      "_x005F_x0041_ _x005F_x005F_ ordinary_name",
    );
  });
  it.each(
    REPORT_IDS.flatMap((report) => (["ar", "en"] as const).map((lang) => [report, lang] as const)),
  )("keeps %s %s headers and cell types", async (report, language) => {
    const result = await sheet(report, [row(report)], language);
    expect(result.rows[0]?.map((cell) => cell.value)).toEqual(
      REPORT_EXPORT_COLUMNS[report].map((column) => column.header[language]),
    );
    for (const [index, column] of REPORT_EXPORT_COLUMNS[report].entries()) {
      expect(result.rows[1]?.[index]).toMatchObject(
        column.kind === "money"
          ? { kind: "text", value: "12.500", format: "@" }
          : column.kind === "count"
            ? { kind: "number", value: "2" }
            : { kind: "text", value: column.kind === "date" ? "2026-10-23" : "label" },
      );
    }
    expect(result.formulaMarkup).toBe(false);
    expect(result.externalRelationship).toBe(false);
  });
  it.each(TRIGGERS)(
    "guards formula trigger %j in a streamed R7 reason without losing XML characters",
    async (trigger) => {
      const reason = `${trigger}HYPERLINK("http://example.test")&<token>`;
      const result = await sheet("refunds", [row("refunds", { reason: text(reason) })]);
      const index = REPORT_EXPORT_COLUMNS.refunds.findIndex((column) => column.key === "reason");
      expect(result.rows[1]?.[index]?.value).toBe(`'${reason}`);
      expect(result.formulaMarkup).toBe(false);
      expect(result.hyperlinkMarkup).toBe(false);
      expect(result.externalRelationship).toBe(false);
    },
  );
  it.each(["\u0000", "\u000b", "\ud800"])(
    "refuses forbidden XML character %j without a completed artifact",
    async (value) => {
      await expect(sheet("refunds", [row("refunds", { reason: text(value) })])).rejects.toThrow(
        "export_value_invalid",
      );
    },
  );
});
