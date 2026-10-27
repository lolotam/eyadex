import { REPORT_EXPORT_COLUMNS, REPORT_IDS } from "@eyadex/contracts/finance-reports";
import { describe, expect, it } from "vitest";

import {
  OVER,
  TRIGGERS,
  count,
  date,
  money,
  parseCsv,
  row,
  success,
  text,
  written,
} from "./__tests__/export-csv-rows.ts";
import "./__tests__/export-csv-precision.ts";

describe("writeReportCsv", () => {
  it.each(
    REPORT_IDS.flatMap((report) =>
      (["ar", "en"] as const).map((language) => [report, language] as const),
    ),
  )(
    "%s %s headers come from REPORT_EXPORT_COLUMNS, and an empty report still has them",
    (report, language) => {
      const result = success(written(report, [], language));
      expect(result.rowCount).toBe(0);
      const [header, ...body] = parseCsv(result.bytes);
      expect(body).toEqual([]);
      expect(header).toEqual(
        REPORT_EXPORT_COLUMNS[report].map((column) => column.header[language]),
      );
      expect(Buffer.from(result.bytes.subarray(3)).toString("utf8").endsWith("\r\n")).toBe(true);
    },
  );

  it("writes one report's body in contract order, with that row's currency and no clinic constant", () => {
    const result = success(
      written("daily_takings", [
        row("daily_takings", {
          period: date("2026-10"),
          branchName: text("فرع, التجربة"),
          method: text("نقد"),
          currency: text("KWD"),
          netMinor: money(-1n, 3),
        }),
        row("daily_takings", {
          period: date("2026-11-02"),
          currency: text("SAR"),
          inMinor: money(1250n, 2),
        }),
      ]),
    );
    expect(result.rowCount).toBe(2);
    const [header, first, second] = parseCsv(result.bytes);
    expect(header).toEqual(REPORT_EXPORT_COLUMNS.daily_takings.map((column) => column.header.en));
    expect(first).toEqual(["2026-10", "فرع, التجربة", "نقد", "12.500", "12.500", "-0.001", "KWD"]);
    expect(second?.[3]).toBe("12.50");
    expect(second?.[6]).toBe("SAR");
    expect(first?.[6]).not.toBe(second?.[6]);
    const again = success(
      written("daily_takings", [
        row("daily_takings", {
          period: date("2026-10"),
          branchName: text("فرع, التجربة"),
          method: text("نقد"),
          currency: text("KWD"),
          netMinor: money(-1n, 3),
        }),
        row("daily_takings", {
          period: date("2026-11-02"),
          currency: text("SAR"),
          inMinor: money(1250n, 2),
        }),
      ]),
    );
    expect(Buffer.compare(Buffer.from(result.bytes), Buffer.from(again.bytes))).toBe(0);
  });

  it("escapes comma, quote, CR and LF per RFC 4180 without trimming", () => {
    const raw = Buffer.from(
      success(
        written("outstanding", [
          row("outstanding", {
            invoiceNumber: text('say "hi"'),
            branchName: text("alpha,beta"),
            patientName: text("  line1\nline2  "),
            ageBucket: text("line1\rline2"),
            currency: text('a,"b'),
          }),
        ]),
      ).bytes.subarray(3),
    ).toString("utf8");
    expect(raw).toContain('"say ""hi"""');
    expect(raw).toContain('"alpha,beta"');
    expect(raw).toContain('"  line1\nline2  "');
    expect(raw).toContain('"line1\rline2"');
    expect(raw).toContain('"a,""b"');
    expect(raw.endsWith("\r\n")).toBe(true);
  });

  it.each(TRIGGERS)(
    "prefixes a non-numeric cell whose first character is %j before CSV escaping",
    (trigger) => {
      const value = `${trigger}SUM(A1),2`;
      const cells = parseCsv(
        success(
          written("refunds", [
            row("refunds", {
              refundNumber: text(value),
              patientName: text(`${trigger}مراجع`),
              reason: text(value),
              currency: text(value),
              businessDate: date(`${trigger}2026-10-23`),
            }),
          ]),
        ).bytes,
      );
      const body = cells[1]!;
      const keys = REPORT_EXPORT_COLUMNS.refunds.map((column) => column.key);
      const expected: Record<string, string> = {
        refundNumber: `'${value}`,
        patientName: `'${trigger}مراجع`,
        reason: `'${value}`,
        currency: `'${value}`,
        businessDate: `'${trigger}2026-10-23`,
      };
      for (const [key, cell] of Object.entries(expected)) {
        expect(body[keys.indexOf(key)]).toBe(cell);
      }
      const raw = Buffer.from(
        success(
          written("refunds", [row("refunds", { refundNumber: text(value), reason: text(value) })]),
        ).bytes.subarray(3),
      ).toString("utf8");
      expect(raw).toContain(`"'${value}"`);
    },
  );

  it("guards R7 and R8 reasons and spreadsheet text, and keeps a negative difference numeric", () => {
    const refundReason = '=HYPERLINK("http://example.test")';
    const discountReason = "+خصم @تجربة";
    const refunds = parseCsv(
      success(
        written("refunds", [
          row("refunds", { reason: text(refundReason), refundedByName: text(null) }),
        ]),
      ).bytes,
    );
    const discounts = parseCsv(
      success(
        written("discounts", [
          row("discounts", { reason: text(discountReason), discountedByName: text("  -keep") }),
        ]),
      ).bytes,
    );
    const closings = parseCsv(
      success(
        written("cash_closings", [
          row("cash_closings", {
            expectedMinor: money(-1n, 3),
            differenceMinor: money(-3000n, 3),
            countedMinor: money(0n, 3),
            notePresent: text("-3.000"),
            closedByName: text(null),
          }),
        ]),
      ).bytes,
    );
    const refundKeys = REPORT_EXPORT_COLUMNS.refunds.map((column) => column.key);
    const discountKeys = REPORT_EXPORT_COLUMNS.discounts.map((column) => column.key);
    const closingKeys = REPORT_EXPORT_COLUMNS.cash_closings.map((column) => column.key);
    expect(refunds[1]?.[refundKeys.indexOf("reason")]).toBe(`'${refundReason}`);
    expect(refunds[1]?.[refundKeys.indexOf("refundedByName")]).toBe("");
    expect(discounts[1]?.[discountKeys.indexOf("reason")]).toBe(`'${discountReason}`);
    expect(discounts[1]?.[discountKeys.indexOf("discountedByName")]).toBe("  -keep");
    expect(closings[1]?.[closingKeys.indexOf("expectedMinor")]).toBe("-0.001");
    expect(closings[1]?.[closingKeys.indexOf("differenceMinor")]).toBe("-3.000");
    expect(closings[1]?.[closingKeys.indexOf("countedMinor")]).toBe("0.000");
    expect(closings[1]?.[closingKeys.indexOf("notePresent")]).toBe("'-3.000");
    const raw = Buffer.from(
      success(
        written("cash_closings", [
          row("cash_closings", { differenceMinor: money("-3000", 3), notePresent: text("-3.000") }),
        ]),
      ).bytes.subarray(3),
    ).toString("utf8");
    expect(raw).toContain(",-3.000,");
    expect(raw).not.toContain('"-3.000"');
    expect(raw).toContain(",'-3.000,");
  });

  it("writes a wide count as a plain unquoted integer and does not apply the money precision refusal", () => {
    const wideResult = success(written("by_doctor", [row("by_doctor", { quantity: count(OVER) })]));
    const wide = parseCsv(wideResult.bytes);
    expect(wide[1]?.[2]).toBe(OVER.toString());
    const raw = Buffer.from(wideResult.bytes.subarray(3)).toString("utf8");
    expect(raw).toContain(`,${OVER.toString()},`);
    expect(raw).not.toContain(`"${OVER.toString()}"`);
  });
});
