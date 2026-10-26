import { REPORT_EXPORT_COLUMNS, type ReportId } from "@eyadex/contracts/finance-reports";
import type { Language } from "@eyadex/contracts/common";
import { formatSignedMinor } from "@eyadex/contracts/money";

/** خلية نص مطبّعة. `null` خلية فاضية، والنص مايتقصّش. */
export type ExportTextCell = {
  readonly kind: "text";
  readonly value: string | null;
};

/** تاريخ أو فترة كما وصلوا، من غير تحويل منطقة زمنية. */
export type ExportDateCell = {
  readonly kind: "date";
  readonly value: string;
};

/**
 * مبلغ بوحدات صغرى. `minor` يكون `bigint` أو نص عدد صحيح متعارف عليه. الأس على الخلية
 * نفسها، والكاتب يقبل 0 أو 2 أو 3 فقط، مش ثابت عيادة.
 */
export type ExportMoneyCell = {
  readonly kind: "money";
  readonly minor: bigint | string;
  readonly exponent: number;
};

/** عداد غير سالب: `bigint`، أو نص صحيح متعارف عليه، أو عدد صحيح آمن. */
export type ExportCountCell = {
  readonly kind: "count";
  readonly value: bigint | string | number;
};

/** قيمة عمود واحد بعد التطبيع، بنوع العمود عشان النص مايدخلش عمود رقم. */
export type ExportCell = ExportTextCell | ExportDateCell | ExportMoneyCell | ExportCountCell;

/** صف تصدير بمفاتيح أعمدة التقرير. مفتاح زيادة مايتكتبش. */
export type ExportCsvRow = Readonly<Record<string, ExportCell>>;

/** طلب كتابة تقرير واحد. العملة نص على الصف، مش ثابت بيتحقن هنا. */
export type ReportCsvInput = {
  readonly report: ReportId;
  readonly language: Language;
  readonly rows: readonly ExportCsvRow[];
};

/** بايتات الملف كاملة، أو رفض ثابت من غير القيمة ومن غير بايتات. */
export type ReportCsvResult =
  | { readonly ok: true; readonly bytes: Buffer; readonly rowCount: number }
  | { readonly ok: false; readonly code: "export_amount_too_large" | "export_value_invalid" };

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const EXCEL_SIGNIFICANT_DIGITS = 15;
const FORMULA_FIRST = new Set([0x3d, 0x2b, 0x2d, 0x40, 0x09, 0x0d]);
const SIGNED_INTEGER = /^-?(0|[1-9][0-9]*)$/;
const UNSIGNED_INTEGER = /^(0|[1-9][0-9]*)$/;

const invalid = (): ReportCsvResult => ({ ok: false, code: "export_value_invalid" });
const tooLarge = (): ReportCsvResult => ({ ok: false, code: "export_amount_too_large" });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RawCell = {
  readonly kind: unknown;
  readonly value: unknown;
  readonly minor: unknown;
  readonly exponent: unknown;
};

function readRawCell(row: Record<string, unknown>, key: string): RawCell | null {
  const cell = row[key];
  if (!isRecord(cell)) return null;
  return {
    kind: cell["kind"],
    value: cell["value"],
    minor: cell["minor"],
    exponent: cell["exponent"],
  };
}

/** أول حرف `= + - @` أو TAB أو CR يتسابقه `'` قبل تهريب CSV، من غير قص. */
function guardFormula(value: string): string {
  if (value.length === 0 || !FORMULA_FIRST.has(value.charCodeAt(0))) return value;
  return `'${value}`;
}

function escapeCsv(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

function nonNumeric(value: string): string {
  return escapeCsv(guardFormula(value));
}

function readMoney(minor: unknown): bigint | null {
  if (typeof minor === "bigint") return minor;
  if (typeof minor !== "string" || minor === "-0" || !SIGNED_INTEGER.test(minor)) return null;
  return BigInt(minor);
}

function readCount(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value !== "string" || !UNSIGNED_INTEGER.test(value)) return null;
  return BigInt(value);
}

/**
 * الأس المقبول للكاتب هو 0 أو 2 أو 3 فقط. غير كده يترفض قبل `formatSignedMinor`،
 * لأن حشو أس كبير يرمي `RangeError` بدل رفض ثابت.
 */
function readExponent(exponent: unknown): 0 | 2 | 3 | null {
  if (exponent === 0) return 0;
  if (exponent === 2) return 2;
  if (exponent === 3) return 3;
  return null;
}

/**
 * Excel يحتفظ بـ 15 رقمًا معنويًا. الإشارة والنقطة والأصفار البادئة لا تُحسب، وأصفار الحشو
 * الثابتة للعملة (أو أصفار قوة العشرة) ليست دقة إضافية للعدد الصحيح.
 */
function exceedsExcelPrecision(minor: bigint, exponent: number): boolean {
  const absolute = minor < 0n ? -minor : minor;
  const digits = formatSignedMinor(absolute.toString(), exponent)
    .replace(".", "")
    .replace(/^0+/, "")
    .replace(/0+$/, "");
  return digits.length > EXCEL_SIGNIFICANT_DIGITS;
}

type PreparedRow = {
  readonly fields: readonly string[];
  readonly amounts: readonly { readonly minor: bigint; readonly exponent: number }[];
};

function prepareRow(
  columns: (typeof REPORT_EXPORT_COLUMNS)[ReportId],
  rawRow: unknown,
): PreparedRow | null {
  if (!isRecord(rawRow)) return null;
  const fields: string[] = [];
  const amounts: { minor: bigint; exponent: number }[] = [];
  for (const column of columns) {
    const cell = readRawCell(rawRow, column.key);
    if (cell === null || cell.kind !== column.kind) return null;
    if (column.kind === "text") {
      if (typeof cell.value !== "string" && cell.value !== null) return null;
      fields.push(cell.value === null ? "" : nonNumeric(cell.value));
      continue;
    }
    if (column.kind === "date") {
      if (typeof cell.value !== "string") return null;
      fields.push(nonNumeric(cell.value));
      continue;
    }
    if (column.kind === "count") {
      const count = readCount(cell.value);
      if (count === null) return null;
      fields.push(count.toString());
      continue;
    }
    const minor = readMoney(cell.minor);
    const exponent = readExponent(cell.exponent);
    if (minor === null || exponent === null) return null;
    amounts.push({ minor, exponent });
    fields.push(formatSignedMinor(minor.toString(), exponent));
  }
  return { fields, amounts };
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
  if (input.language !== "ar" && input.language !== "en") return invalid();
  const columns = REPORT_EXPORT_COLUMNS[input.report];
  if (columns === undefined || !Array.isArray(input.rows)) return invalid();

  const prepared: PreparedRow[] = [];
  for (const rawRow of input.rows) {
    const row = prepareRow(columns, rawRow);
    if (row === null) return invalid();
    prepared.push(row);
  }
  for (const row of prepared) {
    for (const amount of row.amounts) {
      if (exceedsExcelPrecision(amount.minor, amount.exponent)) return tooLarge();
    }
  }

  const header = columns.map((column) => nonNumeric(column.header[input.language])).join(",");
  const lines = [header, ...prepared.map((row) => row.fields.join(","))];
  const bytes = Buffer.concat([BOM, Buffer.from(`${lines.join("\r\n")}\r\n`, "utf8")]);
  return { ok: true, bytes, rowCount: prepared.length };
}
