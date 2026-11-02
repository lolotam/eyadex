import { REPORT_EXPORT_COLUMNS, type ReportId } from "@eyadex/contracts/finance-reports";
import { expect } from "vitest";

import { writeReportCsv, type ExportCell, type ReportCsvResult } from "../export-csv.ts";

export const TRIGGERS = ["=", "+", "-", "@", "\t", "\n", "\r"] as const;
export const FITS = 999999999999999n;
export const OVER = 1000000000000001n;

/**
 * ينشئ خلية نص لاختبار حفظ القيمة وحارس الصيغ.
 * @param value النص أو الخلية الفارغة
 * @returns خلية نص جاهزة للاختبار
 */
export const text = (value: string | null): ExportCell => ({ kind: "text", value });
/**
 * ينشئ خلية تاريخ من غير تحويل المنطقة الزمنية.
 * @param value التاريخ النصي
 * @returns خلية تاريخ للاختبار
 */
export const date = (value: string): ExportCell => ({ kind: "date", value });
/**
 * ينشئ مبلغًا دقيقًا لاختبار كتابة الوحدات الصغيرة.
 * @param minor المبلغ بوحداته الصغيرة
 * @param exponent أس العملة
 * @returns خلية مبلغ للاختبار
 */
export const money = (minor: bigint | string, exponent: number): ExportCell => ({
  kind: "money",
  minor,
  exponent,
});
/**
 * ينشئ عدادًا لاختبار حدود الدقة.
 * @param value العدد قبل التحقق
 * @returns خلية عداد للاختبار
 */
export const count = (value: bigint | string | number): ExportCell => ({ kind: "count", value });

/**
 * يبني صفًا مطابقًا لأعمدة التقرير مع استبدالات الحالة المختبرة.
 * @param report معرّف التقرير
 * @param overrides الخلايا المطلوب استبدالها
 * @returns صف مكتمل بمفاتيح أعمدة التقرير
 */
export function row(report: ReportId, overrides: Readonly<Record<string, ExportCell>> = {}) {
  const cells: Record<string, ExportCell> = {};
  for (const column of REPORT_EXPORT_COLUMNS[report]) {
    cells[column.key] =
      overrides[column.key] ??
      (column.kind === "money"
        ? money(12500n, 3)
        : column.kind === "count"
          ? count(2n)
          : column.kind === "date"
            ? date("2026-10-23")
            : text("label"));
  }
  return cells;
}

/**
 * يشغّل كاتب CSV بمدخلات الاختبار.
 * @param report معرّف التقرير
 * @param rows صفوف البيانات
 * @param language لغة الترويسات
 * @returns نتيجة الكاتب بالبايتات أو سبب الرفض
 */
export function written(
  report: ReportId,
  rows: Readonly<Record<string, ExportCell>>[],
  language: "ar" | "en" = "en",
) {
  return writeReportCsv({ report, language, rows });
}

/**
 * يفك بايتات الملف لخلايا، بعد ما يتأكد من الـ BOM.
 * @param bytes بايتات CSV الناتجة
 * @returns صفوف الخلايا بعد فك الاقتباس
 */
export function parseCsv(bytes: Uint8Array): string[][] {
  expect(bytes[0]).toBe(0xef);
  expect(bytes[1]).toBe(0xbb);
  expect(bytes[2]).toBe(0xbf);
  const textBody = Buffer.from(bytes.subarray(3)).toString("utf8");
  const rows: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < textBody.length; i += 1) {
    const ch = textBody[i]!;
    if (quoted) {
      if (ch === '"') {
        if (textBody[i + 1] === '"') {
          field += '"';
          i += 1;
          continue;
        }
        quoted = false;
        continue;
      }
      field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      record.push(field);
      field = "";
      continue;
    }
    if (ch === "\r" && textBody[i + 1] === "\n") {
      record.push(field);
      rows.push(record);
      record = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
  }
  expect(field).toBe("");
  expect(record).toEqual([]);
  return rows;
}

/**
 * يثبت نجاح الكاتب قبل إتاحة بايتاته للاختبار.
 * @param result نتيجة كاتب CSV
 * @returns البايتات وعدد الصفوف بعد تأكيد النجاح
 */
export function success(result: ReportCsvResult): { bytes: Uint8Array; rowCount: number } {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error("expected csv bytes");
  expect(result.bytes).toBeInstanceOf(Uint8Array);
  expect(result).not.toHaveProperty("code");
  return result;
}
