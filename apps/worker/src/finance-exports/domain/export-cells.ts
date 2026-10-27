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
export type ReportExportInput = {
  readonly report: ReportId;
  readonly language: Language;
  readonly rows: readonly ExportCsvRow[];
};

/** نص حر بعد حارس الصيغة. المبلغ مش من النوع ده. */
export type PreparedText = { readonly kind: "text"; readonly value: string };

/** مبلغ متعارف عليه كنص عشري، من غير فاصلة اقتباس. */
export type PreparedMoney = {
  readonly kind: "money";
  readonly minor: bigint;
  readonly exponent: 0 | 2 | 3;
  readonly text: string;
};

/** عداد اتتحقق منه ومازال `bigint`، عشان التحويل لرقم يحصل عند كاتب XLSX بس. */
export type PreparedCount = { readonly kind: "count"; readonly value: bigint };

export type PreparedField = PreparedText | PreparedMoney | PreparedCount;

export type PreparedReport =
  | {
      readonly ok: true;
      readonly header: readonly string[];
      readonly rows: readonly (readonly PreparedField[])[];
    }
  | { readonly ok: false; readonly code: "export_value_invalid" };

const FORMULA_FIRST = new Set([0x3d, 0x2b, 0x2d, 0x40, 0x09, 0x0a, 0x0d]);
const SIGNED_INTEGER = /^-?(0|[1-9][0-9]*)$/;
const UNSIGNED_INTEGER = /^(0|[1-9][0-9]*)$/;

const invalid = (): PreparedReport => ({ ok: false, code: "export_value_invalid" });

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

/** أول حرف `= + - @` أو TAB أو LF أو CR يتسابقه `'` قبل التغليف، من غير قص. */
function guardFormula(value: string): string {
  if (value.length === 0 || !FORMULA_FIRST.has(value.charCodeAt(0))) return value;
  return `'${value}`;
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

function prepareRow(
  columns: (typeof REPORT_EXPORT_COLUMNS)[ReportId],
  rawRow: unknown,
): PreparedField[] | null {
  if (!isRecord(rawRow)) return null;
  const fields: PreparedField[] = [];
  for (const column of columns) {
    const cell = readRawCell(rawRow, column.key);
    if (cell === null || cell.kind !== column.kind) return null;
    if (column.kind === "text") {
      if (typeof cell.value !== "string" && cell.value !== null) return null;
      fields.push({ kind: "text", value: cell.value === null ? "" : guardFormula(cell.value) });
      continue;
    }
    if (column.kind === "date") {
      if (typeof cell.value !== "string") return null;
      fields.push({ kind: "text", value: guardFormula(cell.value) });
      continue;
    }
    if (column.kind === "count") {
      const count = readCount(cell.value);
      if (count === null) return null;
      fields.push({ kind: "count", value: count });
      continue;
    }
    const minor = readMoney(cell.minor);
    const exponent = readExponent(cell.exponent);
    if (minor === null || exponent === null) return null;
    fields.push({
      kind: "money",
      minor,
      exponent,
      text: formatSignedMinor(minor.toString(), exponent),
    });
  }
  return fields;
}

/**
 * يطبّع صفوف تقرير واحد للـ CSV والـ XLSX مع بعض: نفس الأعمدة، نفس رفض النوع الغلط،
 * ونفس حارس الصيغة على النص والتاريخ والعملة والترويسة. المبلغ يطلع نص عشري متعارف عليه
 * من غير فاصلة اقتباس، والعداد يفضل `bigint` لحد ما كاتب XLSX يحوّله بعد التحقق.
 *
 * @param input التقرير، ولغة الترويسات، وصفوف مطبّعة بمفاتيح الأعمدة
 * @returns ترويسة وصفوف جاهزة، أو `export_value_invalid` من غير القيمة
 */
export function prepareReportExport(input: ReportExportInput): PreparedReport {
  if (!isRecord(input)) return invalid();
  if (input.language !== "ar" && input.language !== "en") return invalid();
  if (typeof input.report !== "string" || !Object.hasOwn(REPORT_EXPORT_COLUMNS, input.report))
    return invalid();
  const columns = REPORT_EXPORT_COLUMNS[input.report];
  if (!Array.isArray(columns) || !Array.isArray(input.rows)) return invalid();
  const rows: PreparedField[][] = [];
  for (const rawRow of input.rows) {
    const row = prepareRow(columns, rawRow);
    if (row === null) return invalid();
    rows.push(row);
  }
  return {
    ok: true,
    header: columns.map((column) => guardFormula(column.header[input.language])),
    rows,
  };
}
