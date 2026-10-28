import { REPORT_EXPORT_COLUMNS, type ReportId } from "@eyadex/contracts/finance-reports";
import { expect } from "vitest";
import type { ExportCell } from "./mock-export-cells";
import { writeReportCsv } from "./mock-export-csv";

export const text = (value: string | null): ExportCell => ({ kind: "text", value });
export const date = (value: string): ExportCell => ({ kind: "date", value });
export const money = (minor: bigint | string, exponent = 3): ExportCell => ({ kind: "money", minor, exponent });
export const count = (value: bigint | string | number): ExportCell => ({ kind: "count", value });

export function row(report: ReportId, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const column of REPORT_EXPORT_COLUMNS[report]) {
    result[column.key] = column.kind === "money" ? money("12500") : column.kind === "count" ? count(2n) : column.kind === "date" ? date("2026-10-28") : text(`sample-${column.key}`);
  }
  return { ...result, ...overrides };
}

export function artifact(report: ReportId, rows: readonly unknown[], language: "ar" | "en" = "en") {
  const result = writeReportCsv({ report, language, rows });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected complete CSV artifact");
  expect(result.bytes).toBeInstanceOf(Uint8Array);
  expect([...result.bytes.subarray(0, 3)]).toStrictEqual([0xef, 0xbb, 0xbf]);
  const body = new TextDecoder().decode(result.bytes.subarray(3));
  expect(body.endsWith("\r\n")).toBe(true);
  return { ...result, body, records: parseCsv(body) };
}

// Independent record-state parser: no writer/preparation helpers participate in decoding.
function parseCsv(source: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') {
      expect(value).toBe("");
      quoted = true;
    } else if (character === ",") {
      record.push(value);
      value = "";
    } else if (character === "\r" && source[index + 1] === "\n") {
      records.push([...record, value]);
      record = [];
      value = "";
      index += 1;
    } else value += character;
  }
  expect(quoted).toBe(false);
  expect(value).toBe("");
  expect(record).toStrictEqual([]);
  return records;
}

export function refused(input: unknown, code = "export_value_invalid") {
  let result: unknown;
  expect(() => { result = writeReportCsv(input); }).not.toThrow();
  expect(result).toStrictEqual({ ok: false, code });
  expect(result).not.toHaveProperty("bytes");
  expect(JSON.stringify(result)).not.toContain("synthetic-private-marker");
}