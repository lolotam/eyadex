import { describe, expect, it } from "vitest";

import {
  invoiceSettlement,
  newestFirst,
  oldestFirst,
  planCreditApplication,
  planCreditRefund,
  planEditRelease,
  planPayment,
  planPaymentRefund,
  planVoidRelease,
  type SettlementAllocation,
  type SettlementCredit,
  type SettlementPayment,
  type SettlementRefund,
  type SettlementRefundSource,
} from "../settlement.ts";

const AT1 = "2026-10-20T08:00:01.000Z";
const AT2 = "2026-10-20T08:00:02.000Z";

// The fixtures hold only the rows the rule under test reads.
type Fixture = {
  payments: SettlementPayment[];
  allocations: SettlementAllocation[];
  credits: SettlementCredit[];
  refunds: SettlementRefund[];
  refundSources: SettlementRefundSource[];
};

const fixture = () => ({
  payments: [] as SettlementPayment[],
  allocations: [] as SettlementAllocation[],
  credits: [] as SettlementCredit[],
  refunds: [] as SettlementRefund[],
  refundSources: [] as SettlementRefundSource[],
});

const pay = (f: Fixture, id: string, invoiceId: string, amountMinor: bigint) =>
  f.payments.push({ id, invoiceId, amountMinor });

const alloc = (
  f: Fixture,
  id: string,
  invoiceId: string,
  source: { paymentId: string | null; creditId: string | null },
  amountMinor: bigint,
  createdAt: string,
) => f.allocations.push({ id, invoiceId, ...source, amountMinor, createdAt });

const cred = (
  f: Fixture,
  id: string,
  originAllocationId: string,
  amountMinor: bigint,
  createdAt: string,
) => f.credits.push({ id, originAllocationId, amountMinor, cause: "invoice_edited", createdAt });

const inv = (id: string, total: bigint) => ({ id, status: "issued" as const, totalMinor: total });
const voidInv = (id: string, total: bigint) => ({ id, status: "void" as const, totalMinor: total });

const refuses = (run: () => unknown, code: string): void => {
  expect(run).toThrow(expect.objectContaining({ code }));
};

describe("settlement rules — releasing money", () => {
  it("releases the newest allocation first, and the newer id on a tie", () => {
    const f = fixture();
    pay(f, "P", "I", 7000n);
    alloc(f, "A-new", "I", { paymentId: "P", creditId: null }, 3000n, AT2);
    alloc(f, "A-old", "I", { paymentId: "P", creditId: null }, 4000n, AT1);
    expect(planEditRelease(f, inv("I", 7000n), 2000n)).toEqual([
      { allocationId: "A-new", amountMinor: 3000n, cause: "invoice_edited" },
      { allocationId: "A-old", amountMinor: 2000n, cause: "invoice_edited" },
    ]);
    const tie = fixture();
    pay(tie, "P", "I", 7000n);
    alloc(tie, "A-1", "I", { paymentId: "P", creditId: null }, 4000n, AT1);
    alloc(tie, "A-2", "I", { paymentId: "P", creditId: null }, 3000n, AT1);
    expect(planEditRelease(tie, inv("I", 7000n), 2000n).map((r) => r.allocationId)).toEqual([
      "A-2",
      "A-1",
    ]);
  });

  it("voids only what is live", () => {
    const f = fixture();
    pay(f, "P", "I", 7000n);
    alloc(f, "A-part", "I", { paymentId: "P", creditId: null }, 3000n, AT1);
    cred(f, "C-part", "A-part", 1000n, AT1);
    alloc(f, "A-dead", "I", { paymentId: "P", creditId: null }, 4000n, AT2);
    cred(f, "C-dead", "A-dead", 4000n, AT2);
    expect(planVoidRelease(f, inv("I", 7000n))).toEqual([
      { allocationId: "A-part", amountMinor: 2000n, cause: "invoice_voided" },
    ]);
  });
});

describe("settlement rules — spending credit", () => {
  it("spends the oldest credit first, and the lower id on a tie", () => {
    const f = fixture();
    cred(f, "C-new", "A-new", 5000n, AT2);
    cred(f, "C-old", "A-old", 1000n, AT1);
    expect(planCreditApplication(f, inv("I", 5000n), 2500n)).toEqual([
      { creditId: "C-old", amountMinor: 1000n },
      { creditId: "C-new", amountMinor: 1500n },
    ]);
    const tie = fixture();
    cred(tie, "C-2", "A-2", 1000n, AT1);
    cred(tie, "C-1", "A-1", 1000n, AT1);
    expect(planCreditApplication(tie, inv("I", 5000n), 1500n)).toEqual([
      { creditId: "C-1", amountMinor: 1000n },
      { creditId: "C-2", amountMinor: 500n },
    ]);
  });

  it("skips a credit nothing is left of", () => {
    const f = fixture();
    cred(f, "C-spent", "A-old", 1000n, AT1);
    alloc(f, "A-used", "I", { paymentId: null, creditId: "C-spent" }, 1000n, AT2);
    cred(f, "C-live", "A-new", 2000n, AT2);
    expect(planCreditApplication(f, inv("I", 5000n), 1500n)).toEqual([
      { creditId: "C-live", amountMinor: 1500n },
    ]);
  });
});

describe("settlement rules — refusals and their order", () => {
  it("refuses a credit application above what the invoice owes or the balance", () => {
    const f = fixture();
    cred(f, "C", "A", 500n, AT1);
    refuses(() => planCreditApplication(f, inv("I", 1000n), 2000n), "payment_exceeds_balance");
    refuses(() => planCreditApplication(f, inv("I", 5000n), 1000n), "credit_insufficient");
  });

  it("refuses a credit application on a void invoice, and on a settled one", () => {
    const f = fixture();
    cred(f, "C", "A-origin", 500n, AT1);
    refuses(() => planCreditApplication(f, voidInv("I", 1000n), 100n), "invoice_void");
    pay(f, "P", "I", 1000n);
    alloc(f, "A", "I", { paymentId: "P", creditId: null }, 1000n, AT2);
    refuses(() => planCreditApplication(f, inv("I", 1000n), 100n), "invoice_settled");
  });

  it("refuses a payment that is not positive, even on a void invoice", () => {
    const f = fixture();
    const i = inv("I", 1000n);
    const v = voidInv("I", 0n);
    refuses(() => planPayment(f, i, 0n), "invalid_amount");
    refuses(() => planPayment(f, i, -1n), "invalid_amount");
    refuses(() => planPayment(f, v, 0n), "invalid_amount");
    refuses(() => planPayment(f, v, 1n), "invoice_void");
  });

  it("accepts a payment of exactly what the invoice owes and refuses one fil more", () => {
    const f = fixture();
    const i = inv("I", 1000n);
    expect(planPayment(f, i, 1000n)).toEqual({ allocationMinor: 1000n });
    refuses(() => planPayment(f, i, 1001n), "payment_exceeds_balance");
  });

  it("refunds only what the payment still holds on that invoice", () => {
    const f = fixture();
    pay(f, "P", "I1", 1000n);
    alloc(f, "A1", "I1", { paymentId: "P", creditId: null }, 1000n, AT1);
    alloc(f, "A2", "I2", { paymentId: "P", creditId: null }, 1000n, AT2);
    refuses(() => planPaymentRefund(f, "I1", "P", 1500n), "refund_exceeds_available");
    expect(planPaymentRefund(f, "I1", "P", 1000n)).toEqual([
      { allocationId: "A1", amountMinor: 1000n, cause: "refund" },
    ]);
    refuses(() => planPaymentRefund(f, "I1", "P", 0n), "invalid_amount");
    const released = fixture();
    pay(released, "P", "I", 1000n);
    alloc(released, "A", "I", { paymentId: "P", creditId: null }, 1000n, AT1);
    cred(released, "C", "A", 1000n, AT2);
    refuses(() => planPaymentRefund(released, "I", "P", 100n), "refund_exceeds_available");
  });

  it("accepts a credit refund of exactly the balance and refuses one fil more", () => {
    const f = fixture();
    cred(f, "C", "A", 1000n, AT1);
    expect(planCreditRefund(f, 1000n)).toEqual([{ creditId: "C", amountMinor: 1000n }]);
    refuses(() => planCreditRefund(f, 1001n), "credit_insufficient");
  });

  it("refuses a negative new total and a void invoice on an edit", () => {
    const f = fixture();
    refuses(() => planEditRelease(f, inv("I", 1000n), -1n), "invalid_amount");
    refuses(() => planEditRelease(f, voidInv("I", 1000n), 500n), "invoice_void");
  });

  it("releases nothing when the new total equals what is paid", () => {
    const f = fixture();
    pay(f, "P", "I", 1000n);
    alloc(f, "A", "I", { paymentId: "P", creditId: null }, 1000n, AT1);
    expect(planEditRelease(f, inv("I", 1000n), 1000n)).toEqual([]);
  });
});

describe("settlement rules — bounds and ordering", () => {
  it("carries an amount at the bigint ceiling", () => {
    const f = fixture();
    const ceiling = 9_223_372_036_854_775_807n;
    const i = inv("I", ceiling);
    pay(f, "P", "I", ceiling);
    alloc(f, "A", "I", { paymentId: "P", creditId: null }, ceiling, AT1);
    expect(invoiceSettlement(f, i)).toEqual({ state: "paid", paidMinor: ceiling, owedMinor: 0n });
  });

  it("sorts copies and leaves the input alone", () => {
    const rows = [
      { id: "A", createdAt: AT1 },
      { id: "B", createdAt: AT2 },
    ];
    expect(newestFirst(rows).map((row) => row.id)).toEqual(["B", "A"]);
    expect(oldestFirst(rows).map((row) => row.id)).toEqual(["A", "B"]);
    expect(rows.map((row) => row.id)).toEqual(["A", "B"]);
    expect(newestFirst(rows)).not.toBe(rows);
  });
});
