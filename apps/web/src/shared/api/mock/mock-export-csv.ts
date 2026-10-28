import { formatSignedMinor } from "@eyadex/contracts/money";
import {
  prepareReportExport,
  type PreparedField,
  type ReportExportInput,
} from "./mock-export-cells";

export type ReportCsvInput = ReportExportInput;
export type ReportCsvResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly rowCount: number }
  | { readonly ok: false; readonly code: "export_value_invalid" | "export_amount_too_large" };

function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function exceedsExcelPrecision(minor: bigint, exponent: number): boolean {
  const absolute = minor < 0n ? -minor : minor;
  // Currency padding and powers of ten add magnitude, not significant digits.
  const digits = formatSignedMinor(absolute.toString(), exponent)
    .replace(".", "")
    .replace(/^0+/, "")
    .replace(/0+$/, "");
  return digits.length > 15;
}

function csvField(field: PreparedField): string {
  if (field.kind === "money") return field.text;
  if (field.kind === "count") return field.value.toString();
  return escapeCsv(field.value);
}

/** No bytes are allocated until every row and every monetary precision check passes. */
export function writeReportCsv(input: unknown): ReportCsvResult {
  const prepared = prepareReportExport(input);
  if (!prepared.ok) return prepared;
  for (const row of prepared.rows) {
    for (const field of row) {
      if (field.kind === "money" && exceedsExcelPrecision(field.minor, field.exponent))
        return { ok: false, code: "export_amount_too_large" };
    }
  }
  const records = [
    prepared.header.map(escapeCsv).join(","),
    ...prepared.rows.map((row) => row.map(csvField).join(",")),
  ];
  const bytes = new TextEncoder().encode(`\uFEFF${records.join("\r\n")}\r\n`);
  return { ok: true, bytes, rowCount: prepared.rows.length };
}
