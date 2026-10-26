import { REPORT_EXPORT_COLUMNS } from "@eyadex/contracts/finance-reports";
import { describe, expect, it } from "vitest";

import { strFromU8, unzipSync } from "fflate";

import { TRIGGERS, count, date, money, text } from "./export-csv-rows.ts";
import { readXlsx } from "./export-xlsx-xml.ts";
import { filled, refused, sheetOf, success, written } from "./export-xlsx-run.ts";

const LEAK = "LEAK-marker";

describe("writeReportXlsx formula guard", () => {
  it.each(TRIGGERS)(
    "prefixes free text, dates, currency and an R7 reason that starts with %j",
    async (trigger) => {
      const value = `${trigger}SUM(A1)&<2>`;
      const sheet = await sheetOf("refunds", [
        filled("refunds", {
          refundNumber: text(value),
          patientName: text(`${trigger}name-token`),
          reason: text(value),
          currency: text(value),
          businessDate: date(`${trigger}2026-10-23`),
          refundedByName: text(null),
        }),
      ]);
      const keys = REPORT_EXPORT_COLUMNS.refunds.map((column) => column.key);
      const body = sheet.rows[1] ?? [];
      const expected: Record<string, string> = {
        refundNumber: `'${value}`,
        patientName: `'${trigger}name-token`,
        reason: `'${value}`,
        currency: `'${value}`,
        businessDate: `'${trigger}2026-10-23`,
        refundedByName: "",
      };
      for (const [key, textValue] of Object.entries(expected)) {
        const found = body[keys.indexOf(key)];
        expect(found?.kind === "number").toBe(false);
        expect(found?.value).toBe(textValue);
        if (textValue !== "") expect(found?.kind).toBe("text");
      }
      expect(body[keys.indexOf("reason")]?.value.codePointAt(0)).toBe("'".codePointAt(0));
      expect(body[keys.indexOf("reason")]?.value.codePointAt(1)).toBe(trigger.codePointAt(0));
      expect(sheet.formulaMarkup).toBe(false);
      expect(sheet.hyperlinkMarkup).toBe(false);
      expect(sheet.externalRelationship).toBe(false);
    },
  );

  it("guards an R8 reason in the file and leaves the canonical money text unprefixed", async () => {
    const reason = "+خصم @token";
    const discounts = await sheetOf("discounts", [
      filled("discounts", { reason: text(reason), discountedByName: text("  -keep") }),
    ]);
    const closings = await sheetOf("cash_closings", [
      filled("cash_closings", {
        expectedMinor: money(-1n, 3),
        countedMinor: money(0n, 3),
        differenceMinor: money(-3000n, 3),
        notePresent: text("-3.000"),
        closedByName: text(null),
      }),
    ]);
    const discountKeys = REPORT_EXPORT_COLUMNS.discounts.map((column) => column.key);
    const closingKeys = REPORT_EXPORT_COLUMNS.cash_closings.map((column) => column.key);
    expect(discounts.rows[1]?.[discountKeys.indexOf("reason")]?.value).toBe(`'${reason}`);
    expect(discounts.rows[1]?.[discountKeys.indexOf("discountedByName")]?.value).toBe("  -keep");
    expect(closings.rows[1]?.[closingKeys.indexOf("differenceMinor")]).toMatchObject({
      kind: "text",
      value: "-3.000",
      format: "@",
    });
    expect(closings.rows[1]?.[closingKeys.indexOf("expectedMinor")]?.value).toBe("-0.001");
    expect(closings.rows[1]?.[closingKeys.indexOf("countedMinor")]?.value).toBe("0.000");
    expect(closings.rows[1]?.[closingKeys.indexOf("notePresent")]?.value).toBe("'-3.000");
    expect(closings.formulaMarkup).toBe(false);
    expect(closings.hyperlinkMarkup).toBe(false);
  });

  it("keeps a fake hyperlink formula as guarded text, with no formula or external link node", async () => {
    const reason = '=HYPERLINK("http://example.test")';
    const result = await success(written("refunds", [filled("refunds", { reason: text(reason) })]));
    const sheet = readXlsx(result.bytes);
    const index = REPORT_EXPORT_COLUMNS.refunds.findIndex((column) => column.key === "reason");
    expect(sheet.rows[1]?.[index]?.value).toBe(`'${reason}`);
    expect(sheet.formulaMarkup).toBe(false);
    expect(sheet.hyperlinkMarkup).toBe(false);
    expect(sheet.externalRelationship).toBe(false);
  });

  it.each([
    ["leading-cr", "\rSUM(A1)&<2>", "'\rSUM(A1)&<2>"],
    ["embedded-cr", "keep\rmid&<>", "keep\rmid&<>"],
    ["crlf", "keep\r\nmid", "keep\r\nmid"],
    ["leading-crlf", "\r\nSUM", "'\r\nSUM"],
    ["tab", "\tSUM", "'\tSUM"],
    ["lf", "\nSUM", "\nSUM"],
    ["literal-entity", "&#13;", "&#13;"],
    ["literal-named", "&lt;>", "&lt;>"],
  ] as const)(
    "keeps %s after XML line-ending rules, and prefixes only a triggering first character",
    async (_id, input, expected) => {
      const result = await success(
        written("refunds", [filled("refunds", { reason: text(input) })]),
      );
      const sheet = readXlsx(result.bytes);
      const index = REPORT_EXPORT_COLUMNS.refunds.findIndex((column) => column.key === "reason");
      const cell = sheet.rows[1]?.[index];
      expect(cell?.kind).toBe("text");
      expect(cell?.value).toBe(expected);
      expect(cell?.value.startsWith("'")).toBe(expected.startsWith("'"));
      expect(sheet.formulaMarkup).toBe(false);
      expect(sheet.hyperlinkMarkup).toBe(false);
      expect(sheet.externalRelationship).toBe(false);
      const raw = strFromU8(
        unzipSync(result.bytes)["xl/worksheets/sheet1.xml"] ?? new Uint8Array(),
      );
      if (input.includes("\r")) {
        expect(raw).toContain("&#13;");
        expect(raw.includes("\r")).toBe(false);
      }
      if (input === "&#13;") expect(raw).toContain("&amp;#13;");
    },
  );

  it("round-trips prototype-key text beside empty, duplicate, and numeric cells", async () => {
    const result = await success(
      written("by_service", [
        filled("by_service", {
          name: text("before"),
          lineCount: count(4),
          quantity: count(7),
          amountMinor: money(12500n, 3),
          currency: text("constructor"),
        }),
        filled("by_service", {
          name: text("constructor"),
          lineCount: count(0),
          quantity: count(1),
          amountMinor: money(0n, 2),
          currency: text(""),
        }),
        filled("by_service", {
          name: text("__proto__"),
          lineCount: count(2),
          quantity: count(2),
          currency: text("constructor"),
        }),
        filled("by_service", {
          name: text("toString"),
          currency: text("hasOwnProperty"),
        }),
        filled("by_service", {
          name: text("after"),
          currency: text("constructor"),
        }),
      ]),
    );
    const sheet = readXlsx(result.bytes);
    const values = sheet.rows.slice(1).map((row) => row.map((cell) => cell.value));
    expect(values).toEqual([
      ["before", "4", "7", "12.500", "constructor"],
      ["constructor", "0", "1", "0.00", ""],
      ["__proto__", "2", "2", "12.500", "constructor"],
      ["toString", "2", "2", "12.500", "hasOwnProperty"],
      ["after", "2", "2", "12.500", "constructor"],
    ]);
    expect(sheet.rows[1]?.[1]?.kind).toBe("number");
    expect(sheet.rows[1]?.[3]).toMatchObject({ kind: "text", value: "12.500", format: "@" });
    expect(sheet.rows[2]?.[4]?.kind).toBe("empty");
    const raw = strFromU8(unzipSync(result.bytes)["xl/worksheets/sheet1.xml"] ?? new Uint8Array());
    expect(raw).not.toContain("function Object");
    expect(raw).not.toContain("[object Object]");
    expect(sheet.formulaMarkup).toBe(false);
    expect(sheet.hyperlinkMarkup).toBe(false);
  });

  it("round-trips a refunds reason of constructor without shifting the amount", async () => {
    const sheet = await sheetOf("refunds", [
      filled("refunds", {
        refundNumber: text("before"),
        patientName: text("__proto__"),
        refundedByName: text(null),
        reason: text("constructor"),
        currency: text("toString"),
        amountMinor: money(-1n, 3),
      }),
      filled("refunds", {
        reason: text("hasOwnProperty"),
        patientName: text("constructor"),
        currency: text("after"),
      }),
    ]);
    const keys = REPORT_EXPORT_COLUMNS.refunds.map((column) => column.key);
    expect(sheet.rows[1]?.[keys.indexOf("reason")]?.value).toBe("constructor");
    expect(sheet.rows[1]?.[keys.indexOf("patientName")]?.value).toBe("__proto__");
    expect(sheet.rows[1]?.[keys.indexOf("refundedByName")]?.value).toBe("");
    expect(sheet.rows[1]?.[keys.indexOf("amountMinor")]).toMatchObject({
      kind: "text",
      value: "-0.001",
      format: "@",
    });
    expect(sheet.rows[1]?.[keys.indexOf("currency")]?.value).toBe("toString");
    expect(sheet.rows[2]?.[keys.indexOf("reason")]?.value).toBe("hasOwnProperty");
    expect(sheet.rows[2]?.[keys.indexOf("patientName")]?.value).toBe("constructor");
    expect(sheet.rows[2]?.[keys.indexOf("currency")]?.value).toBe("after");
    expect(sheet.worksheetFiles).toBe(1);
  });

  it.each([
    ["c0-soh", "\u0001"],
    ["c0-nul", "\u0000"],
    ["c0-vt", "\u000b"],
    ["c0-us", "\u001f"],
    ["high-surrogate", "\uD800"],
    ["low-surrogate", "\uDC00"],
    ["fffe", "\uFFFE"],
    ["ffff", "\uFFFF"],
  ])("refuses XML-forbidden %s before bytes are produced", async (_id, token) => {
    await refused(
      written("refunds", [
        filled("refunds", { reason: text(`control${token}`), patientName: text(LEAK) }),
      ]),
      LEAK,
    );
  });

  it.each([
    ["arabic", "مرجع-تجربة"],
    ["emoji", "مرجع😀"],
    ["replacement", "keep\uFFFDtoken"],
    ["del", "keep\u007Ftoken"],
    ["discouraged-but-legal", "keep\u009Ftoken"],
  ])("round-trips legal Unicode %s without stripping", async (_id, token) => {
    const sheet = await sheetOf("refunds", [filled("refunds", { reason: text(token) })]);
    const index = REPORT_EXPORT_COLUMNS.refunds.findIndex((column) => column.key === "reason");
    expect(sheet.rows[1]?.[index]).toMatchObject({ kind: "text", value: token });
    expect(sheet.formulaMarkup).toBe(false);
  });

  it.each([
    ["text-in-money", "by_service", { amountMinor: text(LEAK) }],
    ["money-in-text", "by_service", { name: money(1n, 3) }],
    ["count-in-date", "refunds", { businessDate: { kind: "count", value: 1 } as never }],
    ["bad-exponent", "own_summary", { billedMinor: money(1n, 1), currency: text(LEAK) }],
    ["formula-minor", "own_summary", { billedMinor: money("=1+1", 3), currency: text(LEAK) }],
  ] as const)("refuses %s without bytes or the marker", async (_id, report, overrides) => {
    await refused(written(report, [filled(report, overrides)]), LEAK);
  });
});
