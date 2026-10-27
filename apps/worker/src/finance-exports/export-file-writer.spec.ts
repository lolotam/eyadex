import { randomBytes, randomUUID } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { FieldCipher } from "@eyadex/secrets";
import { ExportFileWriter } from "./export-file-writer.ts";
import { writeReportCsv } from "./domain/export-csv.ts";
import type { PreparedExportJob } from "./ports/export-store.ts";

const fence = {
  clinicId: randomUUID(),
  exportId: randomUUID(),
  attempt: 1,
  leaseOwner: "sample-worker",
};
const cipher = new FieldCipher(new Map([[1, randomBytes(32)]]), 1);
const job: PreparedExportJob = {
  report: "own_summary",
  scope: "own",
  format: "csv",
  requestedBy: randomUUID(),
  userId: randomUUID(),
  params: { from: "2026-01-01", to: "2026-12-31", language: "ar", branchIds: [] },
};
const row = (minor = "12500") => ({
  period: { kind: "date" as const, value: "2026-10" },
  billedMinor: { kind: "money" as const, minor, exponent: 3 },
  currency: { kind: "text" as const, value: "KWD" },
});
const signal = new AbortController().signal;
async function plain(writer: ExportFileWriter) {
  await writer.file.verify(signal);
  const parts = [];
  for await (const bytes of writer.file.plaintext(signal)) parts.push(bytes);
  return Buffer.concat(parts);
}

describe("incremental encrypted report writers", () => {
  it("preserves reviewed CSV bytes and counts across individual row writes", async () => {
    const writer = await ExportFileWriter.create(fence, job, cipher, signal);
    try {
      const rows = [row(), row("-1000")];
      for (const value of rows) await writer.write(value);
      await writer.finish();
      const expected = writeReportCsv({ report: job.report, language: "ar", rows });
      expect(expected.ok).toBe(true);
      if (expected.ok) expect(await plain(writer)).toEqual(expected.bytes);
      expect(writer.rowCount).toBe(2);
    } finally {
      await writer.dispose();
    }
  });
  it("rejects unsafe CSV precision instead of publishing a truncated or rounded file", async () => {
    const writer = await ExportFileWriter.create(fence, job, cipher, signal);
    try {
      await expect(writer.write(row("12345678901234567"))).rejects.toThrow(
        "export_amount_too_large",
      );
    } finally {
      await writer.dispose();
    }
  });
  it("streams a real ZIP64 workbook with inline exact money, Arabic headers and no shared string table", async () => {
    const writer = await ExportFileWriter.create(fence, { ...job, format: "xlsx" }, cipher, signal);
    try {
      await writer.write(row("123456789012345678901"));
      await writer.write(row("-1000"));
      await writer.finish();
      const bytes = await plain(writer);
      const files = unzipSync(bytes);
      const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
      expect(sheet).toContain('rightToLeft="1"');
      expect(sheet).toContain("123456789012345678.901");
      expect(sheet).toContain('<c r="B2" s="1" t="inlineStr">');
      expect(sheet).toContain("-1.000");
      expect(sheet.match(/<row r=/g)).toHaveLength(3);
      expect(Object.keys(files)).not.toContain("xl/sharedStrings.xml");
      expect(bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(true);
      expect(writer.rowCount).toBe(2);
    } finally {
      await writer.dispose();
    }
  });
  it.each(["csv", "xlsx"] as const)(
    "writes a valid empty %s report with headers",
    async (format) => {
      const writer = await ExportFileWriter.create(fence, { ...job, format }, cipher, signal);
      try {
        await writer.finish();
        const bytes = await plain(writer);
        if (format === "csv") expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
        else
          expect(
            strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]!).match(/<row r=/g),
          ).toHaveLength(1);
        expect(writer.rowCount).toBe(0);
      } finally {
        await writer.dispose();
      }
    },
  );
});
