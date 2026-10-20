import { describe, expect, it } from "vitest";

import {
  allocationLive,
  creditBalance,
  creditRemaining,
  invoicePaid,
  invoiceSettlement,
  paymentRefundable,
  planCreditApplication,
  planCreditRefund,
  planEditRelease,
  planPayment,
  planPaymentRefund,
  planVoidRelease,
  settlementBreaches,
  SettlementError,
  type PatientMoney,
  type ReleaseCause,
  type SettlementAllocation,
  type SettlementCredit,
  type SettlementErrorCode,
  type SettlementPayment,
  type SettlementRefund,
  type SettlementRefundSource,
} from "../settlement.ts";

describe("settlement — spec §4.3 worked examples", () => {
  // The movements are written by the test itself, one row at a time, so the fixture reads like the table
  // of the spec: each row starts where the one before it ended.
  const payments: SettlementPayment[] = [];
  const allocations: SettlementAllocation[] = [];
  const credits: SettlementCredit[] = [];
  const refunds: SettlementRefund[] = [];
  const refundSources: SettlementRefundSource[] = [];
  const money = (): PatientMoney => ({ payments, allocations, credits, refunds, refundSources });

  interface MutableInvoice {
    id: string;
    status: "issued" | "void";
    totalMinor: bigint;
  }

  const i1: MutableInvoice = { id: "I1", status: "issued", totalMinor: 10000n };
  const i2: MutableInvoice = { id: "I2", status: "issued", totalMinor: 5000n };
  const i3: MutableInvoice = { id: "I3", status: "issued", totalMinor: 5000n };
  const i4: MutableInvoice = { id: "I4", status: "issued", totalMinor: 0n };
  const invoicesSoFar: MutableInvoice[] = [i1];

  // Every written movement advances the clock, so the timestamps read in the order the rows were written.
  let written = 0;
  const stamp = (): string => {
    written += 1;
    return `2026-10-20T08:00:${String(written).padStart(2, "0")}.000Z`;
  };

  const writePayment = (id: string, invoiceId: string, amountMinor: bigint): void => {
    payments.push({ id, invoiceId, amountMinor });
    written += 1;
  };

  const writeAllocation = (
    id: string,
    invoiceId: string,
    source: { paymentId: string | null; creditId: string | null },
    amountMinor: bigint,
  ): void => {
    allocations.push({
      id,
      invoiceId,
      paymentId: source.paymentId,
      creditId: source.creditId,
      amountMinor,
      createdAt: stamp(),
    });
  };

  const writeCredit = (
    id: string,
    originAllocationId: string,
    amountMinor: bigint,
    cause: ReleaseCause,
  ): void => {
    credits.push({ id, originAllocationId, amountMinor, cause, createdAt: stamp() });
  };

  const writeRefund = (id: string, amountMinor: bigint): void => {
    refunds.push({ id, amountMinor });
    written += 1;
  };

  const writeRefundSource = (refundId: string, creditId: string, amountMinor: bigint): void => {
    refundSources.push({ refundId, creditId, amountMinor });
    written += 1;
  };

  const expectSettlementError = (run: () => unknown, code: SettlementErrorCode): void => {
    let caught: unknown = null;
    try {
      run();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SettlementError);
    expect((caught as SettlementError).code).toBe(code);
  };

  it("S1: paying 4000 on a 10000 invoice leaves it partly paid", () => {
    expect(planPayment(money(), i1, 4000n)).toEqual({ allocationMinor: 4000n });
    writePayment("P1", "I1", 4000n);
    writeAllocation("A1", "I1", { paymentId: "P1", creditId: null }, 4000n);
    expect(invoiceSettlement(money(), i1)).toEqual({
      state: "partly_paid",
      paidMinor: 4000n,
      owedMinor: 6000n,
    });
    expect(creditBalance(money())).toBe(0n);
    expect(settlementBreaches(money(), invoicesSoFar)).toEqual([]);
  });

  it("S2: paying the rest closes the invoice", () => {
    expect(planPayment(money(), i1, 6000n)).toEqual({ allocationMinor: 6000n });
    writePayment("P2", "I1", 6000n);
    writeAllocation("A2", "I1", { paymentId: "P2", creditId: null }, 6000n);
    expect(invoiceSettlement(money(), i1)).toEqual({
      state: "paid",
      paidMinor: 10000n,
      owedMinor: 0n,
    });
    expect(creditBalance(money())).toBe(0n);
    expect(settlementBreaches(money(), invoicesSoFar)).toEqual([]);
  });

  it("S3: lowering the total to 7000 releases 3000 into credit", () => {
    expect(planEditRelease(money(), i1, 7000n)).toEqual([
      { allocationId: "A2", amountMinor: 3000n, cause: "invoice_edited" },
    ]);
    writeCredit("C1", "A2", 3000n, "invoice_edited");
    i1.totalMinor = 7000n;
    expect(allocationLive(money(), "A2")).toBe(3000n);
    expect(invoiceSettlement(money(), i1)).toEqual({
      state: "paid",
      paidMinor: 7000n,
      owedMinor: 0n,
    });
    expect(creditBalance(money())).toBe(3000n);
    expect(settlementBreaches(money(), invoicesSoFar)).toEqual([]);
  });

  it("S4: raising the total to 9000 releases nothing and leaves 2000 owed", () => {
    expect(planEditRelease(money(), i1, 9000n)).toEqual([]);
    i1.totalMinor = 9000n;
    expect(invoiceSettlement(money(), i1)).toEqual({
      state: "partly_paid",
      paidMinor: 7000n,
      owedMinor: 2000n,
    });
    expect(creditBalance(money())).toBe(3000n);
    expect(settlementBreaches(money(), invoicesSoFar)).toEqual([]);
  });

  it("S5: applying 3000 of credit to a second invoice spends the credit", () => {
    invoicesSoFar.push(i2);
    expect(planCreditApplication(money(), i2, 3000n)).toEqual([
      { creditId: "C1", amountMinor: 3000n },
    ]);
    writeAllocation("A3", "I2", { paymentId: null, creditId: "C1" }, 3000n);
    expect(invoiceSettlement(money(), i2)).toEqual({
      state: "partly_paid",
      paidMinor: 3000n,
      owedMinor: 2000n,
    });
    expect(creditBalance(money())).toBe(0n);
    expect(settlementBreaches(money(), invoicesSoFar)).toEqual([]);
  });

  it("S6: voiding the second invoice releases its allocation only", () => {
    expect(planVoidRelease(money(), i2)).toEqual([
      { allocationId: "A3", amountMinor: 3000n, cause: "invoice_voided" },
    ]);
    writeCredit("C2", "A3", 3000n, "invoice_voided");
    i2.status = "void";
    expect(invoiceSettlement(money(), i2)).toBeNull();
    expect(invoicePaid(money(), "I2")).toBe(0n);
    expect(creditRemaining(money(), "C1")).toBe(0n);
    expect(creditRemaining(money(), "C2")).toBe(3000n);
    expect(creditBalance(money())).toBe(3000n);
    expect(settlementBreaches(money(), invoicesSoFar)).toEqual([]);
  });

  it("S7: refunding 3000 from the credit spends the credit the void released", () => {
    expect(planCreditRefund(money(), 3000n)).toEqual([{ creditId: "C2", amountMinor: 3000n }]);
    writeRefund("F1", 3000n);
    writeRefundSource("F1", "C2", 3000n);
    expect(creditBalance(money())).toBe(0n);
    expect(settlementBreaches(money(), invoicesSoFar)).toEqual([]);
  });

  it("S8: refunding 1000 from the first payment releases its allocation", () => {
    expect(planPaymentRefund(money(), "I1", "P1", 1000n)).toEqual([
      { allocationId: "A1", amountMinor: 1000n, cause: "refund" },
    ]);
    writeCredit("C3", "A1", 1000n, "refund");
    writeRefund("F2", 1000n);
    writeRefundSource("F2", "C3", 1000n);
    expect(invoiceSettlement(money(), i1)).toEqual({
      state: "partly_paid",
      paidMinor: 6000n,
      owedMinor: 3000n,
    });
    expect(creditBalance(money())).toBe(0n);
    // Conservation, written as the spec writes it: payments = paid + credit + refunds.
    const received = payments.reduce((sum, payment) => sum + payment.amountMinor, 0n);
    const refunded = refunds.reduce((sum, refund) => sum + refund.amountMinor, 0n);
    const paid = invoicePaid(money(), "I1") + invoicePaid(money(), "I2");
    expect(received).toBe(10000n);
    expect(invoicePaid(money(), "I1")).toBe(6000n);
    expect(invoicePaid(money(), "I2")).toBe(0n);
    expect(refunded).toBe(4000n);
    expect(received).toBe(paid + creditBalance(money()) + refunded);
    expect(paymentRefundable(money(), "P1")).toBe(3000n);
    expect(paymentRefundable(money(), "P2")).toBe(3000n);
    expect(settlementBreaches(money(), invoicesSoFar)).toEqual([]);
  });

  it("S9: paying more than the invoice owes is refused and nothing is written", () => {
    expectSettlementError(() => planPayment(money(), i3, 6000n), "payment_exceeds_balance");
    expect(payments).toHaveLength(2);
    expect(invoiceSettlement(money(), i3)).toEqual({
      state: "unpaid",
      paidMinor: 0n,
      owedMinor: 5000n,
    });
  });

  it("S10: refunding more than the payment still holds on that invoice is refused", () => {
    expectSettlementError(
      () => planPaymentRefund(money(), "I1", "P1", 4000n),
      "refund_exceeds_available",
    );
    expect(invoiceSettlement(money(), i1)).toEqual({
      state: "partly_paid",
      paidMinor: 6000n,
      owedMinor: 3000n,
    });
  });

  it("S11: a zero-total invoice is already settled", () => {
    expect(invoiceSettlement(money(), i4)).toEqual({ state: "paid", paidMinor: 0n, owedMinor: 0n });
    expectSettlementError(() => planPayment(money(), i4, 1n), "invoice_settled");
  });
});
