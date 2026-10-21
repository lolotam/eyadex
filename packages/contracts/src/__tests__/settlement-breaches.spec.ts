import { describe, expect, it } from "vitest";

import {
  settlementBreaches,
  type SettlementAllocation,
  type SettlementCredit,
  type SettlementPayment,
  type SettlementRefund,
  type SettlementRefundSource,
} from "../settlement.ts";

const AT1 = "2026-10-20T08:00:01.000Z";
const AT2 = "2026-10-20T08:00:02.000Z";
const AT3 = "2026-10-20T08:00:03.000Z";

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

const refund = (f: Fixture, id: string, amountMinor: bigint) => f.refunds.push({ id, amountMinor });

const source = (f: Fixture, refundId: string, creditId: string, amountMinor: bigint) =>
  f.refundSources.push({ refundId, creditId, amountMinor });

const inv = (id: string, total: bigint) => ({ id, status: "issued" as const, totalMinor: total });
const voidInv = (id: string, total: bigint) => ({ id, status: "void" as const, totalMinor: total });

describe("settlement rules — the money invariants", () => {
  it("names an allocation that released more than it held, and a payment over-released", () => {
    const f = fixture();
    alloc(f, "A", "I", { paymentId: null, creditId: "C" }, 1000n, AT1);
    cred(f, "C", "A", 1500n, AT2);
    expect(settlementBreaches(f, [inv("I", 1000n)])).toEqual(["allocation_live"]);
    // A payment can only over-release by releasing more than one of its allocations holds, so the live
    // rule fires with it; the database checks the live rule first too (0066).
    const over = fixture();
    pay(over, "P", "I", 500n);
    alloc(over, "A", "I", { paymentId: "P", creditId: null }, 500n, AT1);
    cred(over, "C", "A", 800n, AT2);
    expect(settlementBreaches(over, [inv("I", 1000n)])).toEqual([
      "allocation_live",
      "payment_released",
    ]);
  });

  it("names a credit that was spent beyond its amount", () => {
    const f = fixture();
    pay(f, "P", "I", 1000n);
    alloc(f, "A", "I", { paymentId: "P", creditId: null }, 1000n, AT1);
    cred(f, "C", "A", 500n, AT2);
    refund(f, "F", 800n);
    source(f, "F", "C", 800n);
    expect(settlementBreaches(f, [inv("I", 1000n)])).toEqual(["credit_remaining"]);
  });

  it("names a payment that was not placed in full", () => {
    const f = fixture();
    pay(f, "P", "I", 900n);
    alloc(f, "A", "I", { paymentId: "P", creditId: null }, 1000n, AT1);
    pay(f, "P2", "I", 100n);
    expect(settlementBreaches(f, [inv("I", 1000n)])).toEqual(["payment_allocated"]);
  });

  it("names an issued invoice that holds more than its total, and a void one", () => {
    const over = fixture();
    pay(over, "P", "I", 1200n);
    alloc(over, "A", "I", { paymentId: "P", creditId: null }, 1200n, AT1);
    expect(settlementBreaches(over, [inv("I", 1000n)])).toEqual(["invoice_paid"]);
    const voided = fixture();
    pay(voided, "P", "I", 500n);
    alloc(voided, "A", "I", { paymentId: "P", creditId: null }, 500n, AT1);
    expect(settlementBreaches(voided, [voidInv("I", 1000n)])).toEqual(["invoice_paid"]);
  });

  it("names a refund whose sources do not add up to it", () => {
    const f = fixture();
    pay(f, "P", "I", 1000n);
    alloc(f, "A", "I", { paymentId: "P", creditId: null }, 1000n, AT1);
    cred(f, "C1", "A", 500n, AT2);
    cred(f, "C2", "A", 500n, AT3);
    refund(f, "F1", 300n);
    source(f, "F1", "C1", 200n);
    refund(f, "F2", 100n);
    source(f, "F2", "C2", 200n);
    expect(settlementBreaches(f, [inv("I", 1000n)])).toEqual(["refund_sources"]);
  });

  it("names money that is not conserved, and finds nothing wrong with sound money", () => {
    const broken = fixture();
    pay(broken, "P", "I", 1000n);
    alloc(broken, "A", "I", { paymentId: "P", creditId: null }, 1000n, AT1);
    cred(broken, "C", "A", 500n, AT2);
    // A source whose refund does not exist: the refund check cannot see it, but the sum does.
    source(broken, "F-missing", "C", 200n);
    expect(settlementBreaches(broken, [inv("I", 1000n)])).toEqual(["conservation"]);
    const sound = fixture();
    pay(sound, "P", "I", 1000n);
    alloc(sound, "A", "I", { paymentId: "P", creditId: null }, 1000n, AT1);
    expect(settlementBreaches(sound, [inv("I", 1000n)])).toEqual([]);
  });
});
