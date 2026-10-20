import { describe, expect, it } from "vitest";

import {
  cashClosingDetailSchema,
  cashClosingPreviewQuerySchema,
  cashClosingPreviewResponseSchema,
  cashClosingResponseSchema,
  cashClosingSchema,
  cashMovementSchema,
  createCashClosingRequestSchema,
  methodTotalSchema,
} from "../finance.ts";

const ID = "0198f0a0-0000-7000-8000-000000000001";
const AT = "2026-10-20T08:00:00.000Z";
const movements = [
  {
    kind: "payment",
    paymentId: ID,
    receiptNumber: "SLM-R-2026-000001",
    cashSeq: "1",
    amountMinor: "1000",
    at: AT,
  },
  {
    kind: "refund",
    refundId: ID,
    refundNumber: "SLM-RF-2026-000001",
    cashSeq: "2",
    amountMinor: "1500",
    at: AT,
  },
];
const totals = { method: "cash", inMinor: "1000", outMinor: "1500" };
const preview = {
  branchId: ID,
  businessDate: "2026-10-20",
  previousClosingId: null,
  fromCashSeq: "0",
  throughCashSeq: "2",
  cashInMinor: "1000",
  cashOutMinor: "1500",
  expectedMinor: "-500",
  methodTotals: [totals],
  movements,
  currency: "KWD",
  currencyExponent: 3,
};
const request = { branchId: ID, previousClosingId: null, throughCashSeq: "2", countedMinor: "0" };
const closing = {
  id: ID,
  branchId: ID,
  businessDate: "2026-10-20",
  previousClosingId: null,
  fromCashSeq: "0",
  toCashSeq: "2",
  expectedMinor: "-500",
  countedMinor: "0",
  differenceMinor: "500",
  methodTotals: [totals],
  note: null,
  currency: "KWD",
  currencyExponent: 3,
  closedBy: ID,
  closedAt: AT,
};
const closingCases = [
  { name: "entity", schema: cashClosingSchema, value: closing },
  { name: "detail", schema: cashClosingDetailSchema, value: { ...closing, movements } },
];

describe("cash closing requests", () => {
  it("accepts a zero count without requiring a note in the schema", () => {
    expect(createCashClosingRequestSchema.parse(request)).toEqual(request);
  });

  it("refuses a negative count", () => {
    expect(
      createCashClosingRequestSchema.safeParse({ ...request, countedMinor: "-1" }).success,
    ).toBe(false);
  });

  it("turns a blank note into null", () => {
    expect(createCashClosingRequestSchema.parse({ ...request, note: " \u200b " }).note).toBeNull();
  });

  it("trims and strips invisible controls from a note", () => {
    expect(createCashClosingRequestSchema.parse({ ...request, note: " A\u202eB " }).note).toBe(
      "AB",
    );
  });

  it("caps notes at 300 visible characters", () => {
    expect(
      createCashClosingRequestSchema.safeParse({ ...request, note: "a".repeat(300) }).success,
    ).toBe(true);
    expect(
      createCashClosingRequestSchema.safeParse({ ...request, note: "a".repeat(301) }).success,
    ).toBe(false);
  });

  it("requires the preview's previous closing id even for the first closing", () => {
    const { previousClosingId: _previous, ...missing } = request;
    expect(createCashClosingRequestSchema.safeParse(missing).success).toBe(false);
  });

  it("requires canonical bigint text for the preview position", () => {
    expect(
      createCashClosingRequestSchema.safeParse({ ...request, throughCashSeq: 2 }).success,
    ).toBe(false);
  });
});

describe("cash closing reads", () => {
  it("previews a branch without storing a closing", () => {
    expect(cashClosingPreviewQuerySchema.parse({ branchId: ID })).toEqual({ branchId: ID });
  });

  it("accepts a negative expected amount in the preview", () => {
    expect(cashClosingPreviewResponseSchema.parse(preview)).toEqual(preview);
  });

  it("accepts a saved negative expected amount", () => {
    expect(cashClosingSchema.parse(closing)).toEqual(closing);
  });

  it("accepts a negative difference when counted cash is below expected", () => {
    expect(
      cashClosingSchema.parse({ ...closing, expectedMinor: "1000", differenceMinor: "-1000" })
        .differenceMinor,
    ).toBe("-1000");
  });

  it.each(movements)("accepts the numbered $kind cash movement", (movement) => {
    expect(cashMovementSchema.parse(movement)).toEqual(movement);
  });

  it("returns period movements with the saved detail", () => {
    const detail = { ...closing, movements };
    expect(cashClosingDetailSchema.parse(detail)).toEqual(detail);
    expect(cashClosingResponseSchema.parse({ cashClosing: detail })).toEqual({
      cashClosing: detail,
    });
  });

  it.each([
    { name: "preview", schema: cashClosingPreviewResponseSchema, value: preview },
    { name: "entity", schema: cashClosingSchema, value: closing },
    { name: "detail", schema: cashClosingDetailSchema, value: { ...closing, movements } },
    { name: "request", schema: createCashClosingRequestSchema, value: request },
    { name: "method total", schema: methodTotalSchema, value: totals },
    ...movements.map((value) => ({
      name: `${value.kind} movement`,
      schema: cashMovementSchema,
      value,
    })),
  ])("rejects patientName on $name", ({ schema, value }) => {
    expect(schema.safeParse({ ...value, patientName: "Synthetic patient" }).success).toBe(false);
  });

  it("rejects patient ids nested in preview movements", () => {
    expect(
      cashClosingPreviewResponseSchema.safeParse({
        ...preview,
        movements: [{ ...movements[0], patientId: ID }],
      }).success,
    ).toBe(false);
  });
});

describe("the cash closing amounts add up", () => {
  it("refuses a preview whose expected amount is not the inflows minus the outflows", () => {
    const result = cashClosingPreviewResponseSchema.safeParse({
      ...preview,
      expectedMinor: "500",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("validation.amount");
      expect(result.error.issues[0]?.path).toEqual(["expectedMinor"]);
    }
  });

  it.each(closingCases)(
    "refuses a $name closing whose difference is not the counted amount minus the expected one",
    ({ schema, value }) => {
      const result = schema.safeParse({
        ...value,
        expectedMinor: "1000",
        countedMinor: "900",
        differenceMinor: "500",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("validation.amount");
        expect(result.error.issues[0]?.path).toEqual(["differenceMinor"]);
      }
    },
  );

  it.each(closingCases)(
    "accepts a $name closing whose difference is the counted amount minus the expected one",
    ({ schema, value }) => {
      const result = schema.safeParse({
        ...value,
        expectedMinor: "1000",
        countedMinor: "900",
        differenceMinor: "-100",
      });
      expect(result.success).toBe(true);
    },
  );

  it("refuses a non-canonical amount without crashing the arithmetic rule", () => {
    const result = cashClosingSchema.safeParse({ ...closing, countedMinor: "1.5" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toEqual([["countedMinor"]]);
    }
  });
});

describe("drawer amount bounds (PR #89 review)", () => {
  it("accepts the counted bound and refuses one minor unit more", () => {
    expect(
      createCashClosingRequestSchema.safeParse({ ...request, countedMinor: "1000000000000000000" })
        .success,
    ).toBe(true);
    expect(
      createCashClosingRequestSchema.safeParse({ ...request, countedMinor: "1000000000000000001" })
        .success,
    ).toBe(false);
  });

  it("keeps the difference of the widest expected and counted amounts inside a bigint", () => {
    expect(
      cashClosingSchema.safeParse({
        ...closing,
        expectedMinor: "-1000000000000000000",
        countedMinor: "1000000000000000000",
        differenceMinor: "2000000000000000000",
      }).success,
    ).toBe(true);
  });

  it("refuses an expected amount outside the drawer's bound", () => {
    expect(
      cashClosingSchema.safeParse({
        ...closing,
        expectedMinor: "-1000000000000000001",
        countedMinor: "0",
        differenceMinor: "1000000000000000001",
      }).success,
    ).toBe(false);
    expect(
      cashClosingSchema.safeParse({
        ...closing,
        expectedMinor: "1000000000000000001",
        countedMinor: "1000000000000000000",
        differenceMinor: "-1",
      }).success,
    ).toBe(false);
  });

  it("refuses a preview whose expected amount is outside the drawer's bound", () => {
    expect(
      cashClosingPreviewResponseSchema.safeParse({
        ...preview,
        cashInMinor: "0",
        cashOutMinor: "1000000000000000001",
        expectedMinor: "-1000000000000000001",
      }).success,
    ).toBe(false);
  });
});
