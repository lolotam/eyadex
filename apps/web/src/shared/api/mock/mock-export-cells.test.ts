import { describe, expect, it } from "vitest";
import { REPORT_EXPORT_COLUMNS } from "@eyadex/contracts/finance-reports";
import { prepareReportExport } from "./mock-export-cells";
import { artifact, money, refused, row, text } from "./mock-export-fixtures.test-kit";

const input = (overrides: Record<string, unknown> = {}) => ({
  report: "own_summary",
  language: "en",
  rows: [row("own_summary")],
  ...overrides,
});

describe("standalone cell validation", () => {
  it.each([null, undefined, [], "synthetic-private-marker", 12, {}, { report: "own_summary" }])(
    "refuses malformed input %j",
    (value) => refused(value),
  );

  it.each(["unknown", "toString", "__proto__", "constructor", 1, null])(
    "refuses unknown/inherited report %j",
    (report) => refused(input({ report })),
  );
  it.each(["AR", "fr", "toString", "__proto__", null, 1])(
    "refuses malformed language %j",
    (language) => refused(input({ language })),
  );
  it.each([null, {}, "synthetic-private-marker", 1])("refuses non-array rows %j", (rows) =>
    refused(input({ rows })),
  );
  it.each([null, [], 1, "synthetic-private-marker", {}])(
    "refuses malformed/missing row %j",
    (value) => refused(input({ rows: [value] })),
  );

  it.each([
    "-0",
    "01",
    "-01",
    "+1",
    "1.5",
    "1e3",
    " 1",
    "1 ",
    "",
    "=1",
    "synthetic-private-marker",
    12500,
    NaN,
    Infinity,
    null,
  ])("refuses noncanonical money %j", (minor) => {
    refused(
      input({ rows: [row("own_summary", { billedMinor: { kind: "money", minor, exponent: 3 } })] }),
    );
  });

  it.each([1, 4, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, "3", null, undefined])(
    "refuses unsafe exponent %j",
    (exponent) => {
      refused(
        input({
          rows: [row("own_summary", { billedMinor: { kind: "money", minor: "1", exponent } })],
        }),
      );
    },
  );

  it.each([
    -1,
    -1n,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    NaN,
    Infinity,
    "01",
    "-0",
    "-1",
    "+1",
    "1.0",
    "1e2",
    "=1",
    " 1",
    "",
    null,
  ])("refuses noncanonical/unsafe count %s", (value) => {
    refused({
      report: "by_service",
      language: "en",
      rows: [row("by_service", { quantity: { kind: "count", value } })],
    });
  });

  it.each([
    ["billedMinor", text("synthetic-private-marker")],
    ["period", text("2026-10")],
    ["period", { kind: "date", value: null }],
    ["currency", money("1")],
    ["currency", { kind: "text", value: 1 }],
    ["currency", { kind: "unknown", value: "synthetic-private-marker" }],
    ["currency", { value: "synthetic-private-marker" }],
    ["currency", null],
  ])("refuses mismatched or missing cell kind for %s", (key, cell) =>
    refused(input({ rows: [row("own_summary", { [String(key)]: cell })] })),
  );

  it("never falls back to inherited row cells or inherited cell fields", () => {
    refused(input({ rows: [Object.create(row("own_summary"))] }));
    refused(input({ rows: [row("own_summary", { billedMinor: Object.create(money("1")) })] }));
    refused(Object.create(input()));
  });

  it("ignores extra row keys including inherited catalogue-like names", () => {
    const value = row("own_summary");
    Object.defineProperty(value, "__proto__", {
      value: text("synthetic-private-marker"),
      enumerable: true,
    });
    value["toString"] = text("synthetic-private-marker");
    expect(artifact("own_summary", [value]).records[1]).toStrictEqual([
      "2026-10-28",
      "12.500",
      "sample-currency",
    ]);
  });

  it("returns only a stable refusal if an input getter throws", () => {
    refused({
      get report() {
        throw new Error("synthetic-private-marker");
      },
    });
  });

  it("an invalid later row produces no partial artifact", () => {
    refused(
      input({
        rows: [
          row("own_summary"),
          row("own_summary", {
            billedMinor: { kind: "money", minor: "synthetic-private-marker", exponent: 3 },
          }),
        ],
      }),
    );
  });

  it("validates the complete input before applying the monetary precision guard", () => {
    refused(input({ rows: [row("own_summary", { billedMinor: money("1000000000000001") }), {}] }));
  });

  it("prepares exact bigint values for future writers without CSV precision rejection", () => {
    const huge = "12345678901234567890123456789";
    const prepared = prepareReportExport({
      report: "by_service",
      language: "en",
      rows: [
        row("by_service", {
          amountMinor: money(huge, 2),
          quantity: { kind: "count", value: huge },
        }),
      ],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error("Expected prepared cells");
    expect(prepared.rows[0]?.[2]).toStrictEqual({ kind: "count", value: BigInt(huge) });
    expect(prepared.rows[0]?.[3]).toStrictEqual({
      kind: "money",
      minor: BigInt(huge),
      exponent: 2,
      text: "123456789012345678901234567.89",
    });
  });

  it("guards header text from the catalogue too", () => {
    const header = REPORT_EXPORT_COLUMNS.own_summary[0]?.header;
    if (!header) throw new Error("Missing catalogue header");
    const original = header.en;
    header.en = "=synthetic-header";
    try {
      expect(artifact("own_summary", []).records[0]?.[0]).toBe("'=synthetic-header");
    } finally {
      header.en = original;
    }
  });
});
