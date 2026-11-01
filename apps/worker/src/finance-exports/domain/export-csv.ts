import { formatSignedMinor } from "@eyadex/contracts/money";

import {
  prepareReportExport,
  type ExportCell,
  type ExportCountCell,
  type ExportCsvRow,
  type ExportDateCell,
  type ExportMoneyCell,
  type ExportTextCell,
  type PreparedField,
  type ReportExportInput,
} from "./export-cells.ts";

export type {
  ExportCell,
  ExportCountCell,
  ExportCsvRow,
  ExportDateCell,
  ExportMoneyCell,
  ExportTextCell,
};

/** طلب كتابة CSV. نفس نموذج صفوف التصدير. */
export type ReportCsvInput = ReportExportInput;

/** بايتات الملف كاملة، أو رفض ثابت من غير القيمة ومن غير بايتات. */
export type ReportCsvResult =
  | { readonly ok: true; readonly bytes: Buffer; readonly rowCount: number }
  | { readonly ok: false; readonly code: "export_amount_too_large" | "export_value_invalid" };

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const EXCEL_SIGNIFICANT_DIGITS = 15;

const tooLarge = (): ReportCsvResult => ({ ok: false, code: "export_amount_too_large" });

function escapeCsv(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/**
 * Excel يحتفظ بـ 15 رقمًا معنويًا. الإشارة والنقطة والأصفار البادئة لا تُحسب، وأصفار الحشو
 * الثابتة للعملة (أو أصفار قوة العشرة) ليست دقة إضافية للعدد الصحيح. الرفض ده للـ CSV فقط.
 */
function exceedsExcelPrecision(minor: bigint, exponent: number): boolean {
  const absolute = minor < 0n ? -minor : minor;
  const digits = formatSignedMinor(absolute.toString(), exponent)
    .replace(".", "")
    .replace(/^0+/, "")
    .replace(/0+$/, "");
  return digits.length > EXCEL_SIGNIFICANT_DIGITS;
}

function csvField(field: PreparedField): string {
  if (field.kind === "money") return field.text;
  if (field.kind === "count") return field.value.toString();
  return escapeCsv(field.value);
}

/**
 * يكتب تقريرًا واحدًا كـ CSV كامل في الذاكرة. الترتيب والترويسات من `REPORT_EXPORT_COLUMNS`
 * حسب التقرير ولغة الطلب، والمبالغ من وحدات صغرى صحيحة عبر `formatSignedMinor`. لو أي مبلغ
 * عدى 15 رقمًا معنويًا الرفض `export_amount_too_large` من غير بايتات، فالملف مايتكتبش.
 *
 * @param input التقرير، ولغة الترويسات، وصفوف مطبّعة بمفاتيح الأعمدة
 * @returns بايتات UTF-8 مع BOM وعدد صفوف البيانات، أو كود رفض ثابت من غير القيمة
 */
export function writeReportCsv(input: ReportCsvInput): ReportCsvResult {
  const prepared = prepareReportExport(input);
  if (!prepared.ok) return prepared;
  for (const row of prepared.rows) {
    for (const field of row) {
      if (field.kind === "money" && exceedsExcelPrecision(field.minor, field.exponent))
        return tooLarge();
    }
  }
  const lines = [
    prepared.header.map(escapeCsv).join(","),
    ...prepared.rows.map((row) => row.map(csvField).join(",")),
  ];
  const bytes = Buffer.concat([BOM, Buffer.from(`${lines.join("\r\n")}\r\n`, "utf8")]);
  return { ok: true, bytes, rowCount: prepared.rows.length };
}
