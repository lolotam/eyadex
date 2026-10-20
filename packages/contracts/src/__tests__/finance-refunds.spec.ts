import { describe, expect, it } from "vitest";

import {
  createRefundRequestSchema,
  invoicePaymentMovementSchema,
  invoicePaymentsResponseSchema,
  refundResponseSchema,
  refundSchema,
  refundWriteResponseSchema,
} from "../finance.ts";

const ID = "0198f0a0-0000-7000-8000-000000000001";
const AT = "2026-10-20T08:00:00.000Z";
const request = {
  source: "payment",
  paymentId: ID,
  amountMinor: "1000",
  method: "other",
  reason: "Correction",
};
const refund = {
  id: ID,
  refundNumber: "SLM-RF-2026-000001",
  branchId: ID,
  invoiceId: ID,
  invoiceNumber: "SLM-2026-000001",
  patientId: ID,
  patientName: "Synthetic patient",
  method: "cash",
  amountMinor: "1000",
  currency: "KWD",
  currencyExponent: 3,
  reason: "Correction",
  refundedAt: AT,
  businessDate: "2026-10-20",
  cashSeq: "1",
  refundedBy: ID,
};

describe("refund requests", () => {
  it("accepts a payment refund using a different method", () => {
    expect(createRefundRequestSchema.parse(request)).toEqual(request);
  });

  it("requires paymentId for a payment refund", () => {
    const { paymentId: _paymentId, ...missing } = request;
    expect(createRefundRequestSchema.safeParse(missing).success).toBe(false);
  });

  it("allows a credit refund only without paymentId", () => {
    const { paymentId: _paymentId, ...credit } = { ...request, source: "credit" };
    expect(createRefundRequestSchema.parse(credit)).toEqual(credit);
    expect(createRefundRequestSchema.safeParse({ ...credit, paymentId: ID }).success).toBe(false);
  });

  it.each(["", " ", "a".repeat(301)])(
    "validates the credit refund's reason independently",
    (reason) => {
      const { paymentId: _paymentId, ...credit } = { ...request, source: "credit", reason };
      expect(createRefundRequestSchema.safeParse(credit).success).toBe(false);
    },
  );

  it.each(["", " \u200b "])("requires a visible reason: %s", (reason) => {
    expect(createRefundRequestSchema.safeParse({ ...request, reason }).success).toBe(false);
  });

  it("caps the reason at 300 characters", () => {
    expect(
      createRefundRequestSchema.safeParse({ ...request, reason: "a".repeat(300) }).success,
    ).toBe(true);
    expect(
      createRefundRequestSchema.safeParse({ ...request, reason: "a".repeat(301) }).success,
    ).toBe(false);
  });

  it("trims and strips controls from a reason", () => {
    expect(createRefundRequestSchema.parse({ ...request, reason: " A\u202eB " }).reason).toBe("AB");
  });

  it.each(["0", "-1"])("refuses non-positive amount %s in both variants", (amountMinor) => {
    expect(createRefundRequestSchema.safeParse({ ...request, amountMinor }).success).toBe(false);
    const { paymentId: _paymentId, ...credit } = { ...request, source: "credit", amountMinor };
    expect(createRefundRequestSchema.safeParse(credit).success).toBe(false);
  });

  it("refuses an unknown refund method", () => {
    expect(createRefundRequestSchema.safeParse({ ...request, method: "card" }).success).toBe(false);
  });
});

describe("refund entities", () => {
  it("accepts a numbered cash refund", () => {
    expect(refundSchema.parse(refund)).toEqual(refund);
  });

  it("requires a refund number", () => {
    const { refundNumber: _number, ...missing } = refund;
    expect(refundSchema.safeParse(missing).success).toBe(false);
  });

  it("requires a cash sequence for cash", () => {
    expect(refundSchema.safeParse({ ...refund, cashSeq: null }).success).toBe(false);
  });

  it("requires null for noncash", () => {
    expect(refundSchema.safeParse({ ...refund, method: "knet" }).success).toBe(false);
    expect(refundSchema.safeParse({ ...refund, method: "knet", cashSeq: null }).success).toBe(true);
  });

  it("supports a void invoice's null settlement", () => {
    const response = { refund, settlement: null, creditBalanceMinor: "0" };
    expect(refundWriteResponseSchema.parse(response)).toEqual(response);
    expect(refundResponseSchema.parse({ refund })).toEqual({ refund });
  });
});

describe("invoice payment history", () => {
  const base = { amountMinor: "1000", at: AT, by: ID };
  const movements = [
    {
      ...base,
      kind: "payment",
      paymentId: ID,
      receiptNumber: "SLM-R-2026-000001",
      method: "cash",
      refundableMinor: "0",
    },
    { ...base, kind: "credit_applied", allocationId: ID, creditId: ID },
    {
      ...base,
      kind: "credit_released",
      creditId: ID,
      originAllocationId: ID,
      cause: "invoice_edited",
    },
    {
      ...base,
      kind: "refund",
      refundId: ID,
      refundNumber: "SLM-RF-2026-000001",
      method: "bank_transfer",
      reason: "Correction",
    },
  ];

  it.each(movements)("accepts a complete $kind movement", (movement) => {
    expect(invoicePaymentMovementSchema.parse(movement)).toEqual(movement);
  });

  it.each(movements)("rejects fields from another kind on $kind", (movement) => {
    expect(invoicePaymentMovementSchema.safeParse({ ...movement, unexpected: ID }).success).toBe(
      false,
    );
  });

  it.each(["invoice_edited", "invoice_voided", "refund"])("records release cause %s", (cause) => {
    expect(invoicePaymentMovementSchema.safeParse({ ...movements[2], cause }).success).toBe(true);
  });

  it("refuses unknown release causes", () => {
    expect(
      invoicePaymentMovementSchema.safeParse({ ...movements[2], cause: "other" }).success,
    ).toBe(false);
  });

  it("preserves all movements and the patient's credit balance", () => {
    const response = {
      invoiceId: ID,
      currency: "KWD",
      currencyExponent: 3,
      settlement: null,
      creditBalanceMinor: "1000",
      movements,
    };
    expect(invoicePaymentsResponseSchema.parse(response)).toEqual(response);
  });

  const paymentMovement = {
    ...base,
    kind: "payment",
    paymentId: ID,
    receiptNumber: "SLM-R-2026-000001",
    method: "cash",
    refundableMinor: "0",
  };

  it("accepts a refundable amount equal to the amount paid", () => {
    const movement = { ...paymentMovement, refundableMinor: "1000" };
    expect(invoicePaymentMovementSchema.parse(movement)).toEqual(movement);
  });

  it("refuses a refundable amount above the amount paid (#91)", () => {
    const result = invoicePaymentMovementSchema.safeParse({
      ...paymentMovement,
      refundableMinor: "1001",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["refundableMinor"]]);
  });

  it("refuses a negative refundable amount", () => {
    const result = invoicePaymentMovementSchema.safeParse({
      ...paymentMovement,
      refundableMinor: "-1",
    });
    expect(result.success).toBe(false);
  });

  it("refuses the same payment movement inside the invoice history", () => {
    const response = {
      invoiceId: ID,
      currency: "KWD",
      currencyExponent: 3,
      settlement: null,
      creditBalanceMinor: "0",
      movements: [{ ...paymentMovement, refundableMinor: "1001" }],
    };
    expect(invoicePaymentsResponseSchema.safeParse(response).success).toBe(false);
  });
});
