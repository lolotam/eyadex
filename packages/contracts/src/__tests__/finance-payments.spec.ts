import { describe, expect, it } from "vitest";

import {
  cashSeqSchema,
  createCreditApplicationRequestSchema,
  createPaymentRequestSchema,
  creditApplicationResponseSchema,
  PAYMENT_METHODS,
  paymentMethodsRequestSchema,
  paymentResponseSchema,
  paymentSchema,
  paymentWriteResponseSchema,
} from "../finance.ts";
import { MAX_MINOR } from "../money.ts";

const ID = "0198f0a0-0000-7000-8000-000000000001";
const AT = "2026-10-20T08:00:00.000Z";
const settlement = { state: "partly_paid", paidMinor: "1000", owedMinor: "2000" };
const payment = {
  id: ID,
  receiptNumber: "SLM-R-2026-000001",
  branchId: ID,
  invoiceId: ID,
  invoiceNumber: "SLM-2026-000001",
  patientId: ID,
  patientName: "Synthetic patient",
  method: "cash",
  amountMinor: "1000",
  currency: "KWD",
  currencyExponent: 3,
  reference: null,
  receivedAt: AT,
  businessDate: "2026-10-20",
  cashSeq: "9007199254740993",
  receivedBy: ID,
};

describe("payment methods", () => {
  const methods = PAYMENT_METHODS.map((method) => ({ method, enabled: true }));

  it("keeps the fixed order of the four methods", () => {
    expect(PAYMENT_METHODS).toEqual(["cash", "knet", "bank_transfer", "other"]);
  });

  it("accepts the complete settings in any order", () => {
    const paymentMethods = [...methods].reverse();
    expect(paymentMethodsRequestSchema.parse({ paymentMethods }).paymentMethods).toEqual(
      paymentMethods,
    );
  });

  it("leaves the all-disabled rule to the use case", () => {
    const paymentMethods = methods.map((v) => ({ ...v, enabled: false }));
    expect(paymentMethodsRequestSchema.safeParse({ paymentMethods }).success).toBe(true);
  });

  it("requires all four methods", () => {
    expect(
      paymentMethodsRequestSchema.safeParse({ paymentMethods: methods.slice(1) }).success,
    ).toBe(false);
  });

  it("refuses a duplicate in a four-item replacement", () => {
    const result = paymentMethodsRequestSchema.safeParse({
      paymentMethods: [methods[0], ...methods.slice(0, 3)],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("validation.duplicate");
  });

  it("refuses a fifth method even if it is a known method", () => {
    expect(
      paymentMethodsRequestSchema.safeParse({ paymentMethods: [...methods, methods[0]] }).success,
    ).toBe(false);
  });

  it("refuses an unknown method within four settings", () => {
    expect(
      paymentMethodsRequestSchema.safeParse({
        paymentMethods: [...methods.slice(1), { method: "card", enabled: true }],
      }).success,
    ).toBe(false);
  });
});

describe("payment requests", () => {
  const request = { method: "knet", amountMinor: "1000" };

  it("accepts a payment without a reference", () => {
    expect(createPaymentRequestSchema.parse(request)).toEqual(request);
  });

  it.each(["0", "-1", 1000])("refuses amount %s", (amountMinor) => {
    expect(createPaymentRequestSchema.safeParse({ ...request, amountMinor }).success).toBe(false);
  });

  it("accepts an amount beyond the invoice-line cap", () => {
    expect(
      createPaymentRequestSchema.safeParse({ ...request, amountMinor: "1000000000001" }).success,
    ).toBe(true);
  });

  it("refuses an unknown method", () => {
    expect(createPaymentRequestSchema.safeParse({ ...request, method: "card" }).success).toBe(
      false,
    );
  });

  it("caps the reference at 60 visible characters", () => {
    expect(
      createPaymentRequestSchema.safeParse({ ...request, reference: "a".repeat(60) }).success,
    ).toBe(true);
    expect(
      createPaymentRequestSchema.safeParse({ ...request, reference: "a".repeat(61) }).success,
    ).toBe(false);
  });

  it("normalizes a blank reference to null", () => {
    expect(
      createPaymentRequestSchema.parse({ ...request, reference: " \u200b\u202e " }).reference,
    ).toBeNull();
  });

  it("trims the reference and strips invisible controls", () => {
    expect(
      createPaymentRequestSchema.parse({ ...request, reference: " AB\u200dC " }).reference,
    ).toBe("ABC");
  });

  it.each([{ date: "2026-10-19" }, { idempotencyKey: ID }])(
    "refuses extra body fields %o",
    (extra) => {
      expect(createPaymentRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false);
    },
  );
});

describe("receipt cash positions", () => {
  it("preserves bigint sequence precision", () => {
    expect(paymentSchema.parse(payment).cashSeq).toBe("9007199254740993");
    expect(cashSeqSchema.parse(MAX_MINOR.toString())).toBe(MAX_MINOR.toString());
    expect(cashSeqSchema.parse("0")).toBe("0");
  });

  it.each(["-1", "01", "+1", " 1", "1.5", "9223372036854775808", 1])(
    "refuses sequence %s",
    (cashSeq) => {
      expect(cashSeqSchema.safeParse(cashSeq).success).toBe(false);
    },
  );

  it("requires a sequence on cash receipts", () => {
    expect(paymentSchema.safeParse({ ...payment, cashSeq: null }).success).toBe(false);
  });

  it("requires null on noncash receipts", () => {
    expect(paymentSchema.safeParse({ ...payment, method: "knet" }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...payment, method: "knet", cashSeq: null }).success).toBe(
      true,
    );
  });

  it("requires a receipt number", () => {
    const { receiptNumber: _number, ...missing } = payment;
    expect(paymentSchema.safeParse(missing).success).toBe(false);
  });

  it("returns the receipt and the server's settlement", () => {
    const response = { payment, settlement };
    expect(paymentWriteResponseSchema.parse(response)).toEqual(response);
    expect(paymentResponseSchema.parse({ payment })).toEqual({ payment });
  });
});

describe("explicit credit application", () => {
  const allocation = { id: ID, creditId: ID, amountMinor: "1000", createdAt: AT };
  const response = { allocations: [allocation], settlement, creditBalanceMinor: "0" };

  it("requires a positive amount", () => {
    expect(createCreditApplicationRequestSchema.parse({ amountMinor: "1000" }).amountMinor).toBe(
      "1000",
    );
    expect(createCreditApplicationRequestSchema.safeParse({ amountMinor: "0" }).success).toBe(
      false,
    );
  });

  it("accepts several allocations and the remaining credit balance", () => {
    expect(
      creditApplicationResponseSchema.parse({
        ...response,
        allocations: [allocation, { ...allocation, id: "0198f0a0-0000-7000-8000-000000000002" }],
      }).allocations,
    ).toHaveLength(2);
  });

  it("requires at least one allocation", () => {
    expect(
      creditApplicationResponseSchema.safeParse({ ...response, allocations: [] }).success,
    ).toBe(false);
  });

  it("rejects an empty allocation amount", () => {
    expect(
      creditApplicationResponseSchema.safeParse({
        ...response,
        allocations: [{ ...allocation, amountMinor: "0" }],
      }).success,
    ).toBe(false);
  });
});
