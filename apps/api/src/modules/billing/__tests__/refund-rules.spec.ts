import { SettlementError, type PatientMoney } from "@eyadex/contracts/settlement";
import { describe, expect, it } from "vitest";

import { planRefundFromPayment, refundableFromPayment } from "../domain/refund-rules.ts";

// Finance F2 slice 5 (FIN-14, issue #91): what may still be refunded from a payment, and the plan of a
// refund from it. Amounts are KWD fils.
const PAYMENT = { id: "p1", invoiceId: "i1", amountMinor: 4000n };

/** P1 placed 4000 on I1 in one allocation (F2-Q1); `released` credits came out of it since. */
function moneyOf(released: readonly bigint[]): PatientMoney {
  return {
    payments: [{ id: "p1", invoiceId: "i1", amountMinor: 4000n }],
    allocations: [
      {
        id: "a1",
        invoiceId: "i1",
        paymentId: "p1",
        creditId: null,
        amountMinor: 4000n,
        createdAt: "2026-10-21T08:00:00.000000Z",
      },
    ],
    credits: released.map((amountMinor, i) => ({
      id: `c${i + 1}`,
      originAllocationId: "a1",
      amountMinor,
      cause: "refund" as const,
      createdAt: `2026-10-21T09:00:0${i}.000000Z`,
    })),
    refunds: [],
    refundSources: [],
  };
}

/** The settlement error code a plan throws, or a failed expectation when it throws nothing. */
const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SettlementError);
    return (error as SettlementError).code;
  }
  throw new Error("the plan was not refused");
};

describe("refundableFromPayment (issue #91)", () => {
  it("is the payment's live amount: what it placed minus what was released from it", () => {
    expect(refundableFromPayment(moneyOf([]), PAYMENT)).toBe(4000n);
    expect(refundableFromPayment(moneyOf([1000n, 500n]), PAYMENT)).toBe(2500n);
  });

  it("never promises more than the payment, whatever its allocations say", () => {
    // An allocation larger than its payment cannot be written (0066), but the cap holds without it.
    const money = moneyOf([]);
    const swollen: PatientMoney = {
      ...money,
      allocations: money.allocations.map((row) => ({ ...row, amountMinor: 9000n })),
    };
    expect(refundableFromPayment(swollen, PAYMENT)).toBe(4000n);
  });

  it("is zero, never negative, once everything was released", () => {
    expect(refundableFromPayment(moneyOf([4000n]), PAYMENT)).toBe(0n);
  });
});

describe("planRefundFromPayment (spec §4.3 S8, S10)", () => {
  it("releases the amount from the payment's allocation as a refund credit", () => {
    expect(planRefundFromPayment(moneyOf([]), PAYMENT, 1000n)).toEqual([
      { allocationId: "a1", amountMinor: 1000n, cause: "refund" },
    ]);
  });

  it("refuses more than the payment still holds (S10) and a non-positive amount", () => {
    expect(refusal(() => planRefundFromPayment(moneyOf([1000n]), PAYMENT, 3001n))).toBe(
      "refund_exceeds_available",
    );
    expect(refusal(() => planRefundFromPayment(moneyOf([]), PAYMENT, 0n))).toBe("invalid_amount");
  });
});
