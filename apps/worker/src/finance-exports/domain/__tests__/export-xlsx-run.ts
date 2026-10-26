import { expect } from "vitest";

import type { ReportId } from "@eyadex/contracts/finance-reports";

import { writeReportXlsx, type ReportXlsxResult } from "../export-xlsx.ts";
import { row } from "./export-csv-rows.ts";
import { readXlsx, type XlsxSheet } from "./export-xlsx-xml.ts";

type Row = ReturnType<typeof row>;

export async function written(
  report: ReportId,
  rows: readonly Row[],
  language: "ar" | "en" = "en",
): Promise<ReportXlsxResult> {
  return writeReportXlsx({ report, language, rows });
}

export async function success(result: Promise<ReportXlsxResult> | ReportXlsxResult) {
  const settled = await result;
  expect(settled).toMatchObject({ ok: true });
  if (!settled.ok) throw new Error("expected xlsx bytes");
  expect(Buffer.isBuffer(settled.bytes)).toBe(true);
  expect(settled.bytes.subarray(0, 2).toString("utf8")).toBe("PK");
  expect(settled).not.toHaveProperty("code");
  return settled;
}

export async function sheetOf(
  report: ReportId,
  rows: readonly Row[],
  language: "ar" | "en" = "en",
): Promise<XlsxSheet> {
  const result = await success(written(report, rows, language));
  const sheet = readXlsx(result.bytes);
  expect(sheet.worksheetFiles).toBe(1);
  expect(sheet.workbookSheets).toBe(1);
  expect(result.rowCount).toBe(rows.length);
  return sheet;
}

export async function refused(run: Promise<ReportXlsxResult>, leak: string) {
  let result: ReportXlsxResult | undefined;
  await expect(
    (async () => {
      result = await run;
    })(),
  ).resolves.toBeUndefined();
  expect(result).toEqual({ ok: false, code: "export_value_invalid" });
  expect(result).not.toHaveProperty("bytes");
  expect(JSON.stringify(result)).not.toContain(leak);
  expect(JSON.stringify(result)).not.toContain("-3.000");
}

export function filled(report: ReportId, overrides: Row = {}) {
  return row(report, overrides);
}
