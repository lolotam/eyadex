import { REPORT_EXPORT_COLUMNS, type ReportId } from "@eyadex/contracts/finance-reports";
import type { Language } from "@eyadex/contracts/common";
import { formatSignedMinor } from "@eyadex/contracts/money";

export type ExportTextCell = { readonly kind: "text"; readonly value: string | null };
export type ExportDateCell = { readonly kind: "date"; readonly value: string };
export type ExportMoneyCell = {
  readonly kind: "money";
  readonly minor: bigint | string;
  readonly exponent: number;
};
export type ExportCountCell = {
  readonly kind: "count";
  readonly value: bigint | string | number;
};
export type ExportCell = ExportTextCell | ExportDateCell | ExportMoneyCell | ExportCountCell;
export type ExportCsvRow = Readonly<Record<string, ExportCell>>;
export type ReportExportInput = {
  readonly report: ReportId;
  readonly language: Language;
  readonly rows: readonly ExportCsvRow[];
};
export type PreparedText = { readonly kind: "text"; readonly value: string };
export type PreparedMoney = {
  readonly kind: "money";
  readonly minor: bigint;
  readonly exponent: 0 | 2 | 3;
  readonly text: string;
};
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

function own(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function guardFormula(value: string): string {
  if (value.length === 0 || !FORMULA_FIRST.has(value.charCodeAt(0))) return value;
  return `'${value}`;
}

function readMoney(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value !== "string" || value === "-0" || !SIGNED_INTEGER.test(value)) return null;
  return BigInt(value);
}

function readCount(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value !== "string" || !UNSIGNED_INTEGER.test(value)) return null;
  return BigInt(value);
}

function readExponent(value: unknown): 0 | 2 | 3 | null {
  return value === 0 || value === 2 || value === 3 ? value : null;
}

function prepareRow(
  columns: (typeof REPORT_EXPORT_COLUMNS)[ReportId],
  row: unknown,
): PreparedField[] | null {
  if (!isRecord(row)) return null;
  const fields: PreparedField[] = [];
  for (const column of columns) {
    const cell = own(row, column.key);
    if (!isRecord(cell) || own(cell, "kind") !== column.kind) return null;
    if (column.kind === "text" || column.kind === "date") {
      const value = own(cell, "value");
      if (value === null && column.kind === "text") {
        fields.push({ kind: "text", value: "" });
      } else if (typeof value === "string") {
        fields.push({ kind: "text", value: guardFormula(value) });
      } else return null;
      continue;
    }
    if (column.kind === "count") {
      const value = readCount(own(cell, "value"));
      if (value === null) return null;
      fields.push({ kind: "count", value });
      continue;
    }
    const minor = readMoney(own(cell, "minor"));
    const exponent = readExponent(own(cell, "exponent"));
    if (minor === null || exponent === null) return null;
    fields.push({ kind: "money", minor, exponent, text: formatSignedMinor(minor.toString(), exponent) });
  }
  return fields;
}

/** Shared CSV/XLSX preparation keeps exact numbers and guards only textual cells. */
export function prepareReportExport(input: unknown): PreparedReport {
  // Malformed accessors/proxies must not turn a refusal into a throw or expose their values.
  try {
    if (!isRecord(input)) return invalid();
    const report = own(input, "report");
    const language = own(input, "language");
    const rawRows = own(input, "rows");
    if (language !== "ar" && language !== "en") return invalid();
    if (typeof report !== "string" || !Object.hasOwn(REPORT_EXPORT_COLUMNS, report)) return invalid();
    const entry = Object.entries(REPORT_EXPORT_COLUMNS).find(([key]) => key === report);
    if (!entry || !Array.isArray(rawRows)) return invalid();
    const columns = entry[1];
    const rows: PreparedField[][] = [];
    for (const rawRow of rawRows) {
      const row = prepareRow(columns, rawRow);
      if (row === null) return invalid();
      rows.push(row);
    }
    return { ok: true, header: columns.map((column) => guardFormula(column.header[language])), rows };
  } catch {
    return invalid();
  }
}