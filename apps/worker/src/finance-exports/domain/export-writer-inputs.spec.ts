import { REPORT_EXPORT_COLUMNS } from "@eyadex/contracts/finance-reports";
import { describe, expect, it } from "vitest";

import type { ReportExportInput } from "./export-cells.ts";
import { writeReportCsv } from "./export-csv.ts";
import { writeReportXlsx } from "./export-xlsx.ts";
import { parseCsv, row, text } from "./__tests__/export-csv-rows.ts";

describe("writer input boundaries", () => {
  it.each([null, undefined, false, "report", []])(
    "refuses a non-record input %j",
    async (value) => {
      const input = value as unknown as ReportExportInput;
      expect(writeReportCsv(input)).toEqual({ ok: false, code: "export_value_invalid" });
      await expect(writeReportXlsx(input)).resolves.toEqual({
        ok: false,
        code: "export_value_invalid",
      });
    },
  );

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "unknown", null, {}])(
    "refuses a non-catalogue report key %j even with no rows",
    async (report) => {
      const input = { report, language: "en", rows: [] } as unknown as ReportExportInput;
      expect(writeReportCsv(input)).toEqual({ ok: false, code: "export_value_invalid" });
      await expect(writeReportXlsx(input)).resolves.toEqual({
        ok: false,
        code: "export_value_invalid",
      });
    },
  );

  it.each(["refunds", "discounts"] as const)(
    "guards a leading LF followed by a formula in an exported %s reason",
    (report) => {
      const reason = '\n=HYPERLINK("https://example.test")';
      const result = writeReportCsv({
        report,
        language: "en",
        rows: [row(report, { reason: text(reason) })],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("CSV refused");
      const index = REPORT_EXPORT_COLUMNS[report].findIndex((column) => column.key === "reason");
      expect(parseCsv(result.bytes)[1]?.[index]).toBe(`'${reason}`);
      expect(result.bytes.toString("utf8")).toContain('"\'\n=HYPERLINK(""https://example.test"")"');
    },
  );
});
