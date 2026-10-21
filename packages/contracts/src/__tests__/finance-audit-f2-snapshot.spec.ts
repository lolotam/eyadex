import { describe, expect, it } from "vitest";

import {
  assertFinanceAuditSnapshotShape,
  type CashClosingAuditSnapshot,
  type RefundAuditSnapshot,
} from "../finance-audit-snapshot.ts";

// Finance F2 slice 5 (spec §4.6): the refund and the cash closing snapshots skip the audit scrub, so every
// string in them must keep its shape — a typed reason, note or name can never pass for one.
const CREDIT = "0199a000-0000-7000-8000-000000000004";

const refund: RefundAuditSnapshot = {
  refundNumber: "SLM-RF-2026-000001",
  invoiceNumber: "SLM-2026-000123",
  method: "cash",
  amountMinor: "1500000",
  currency: "KWD",
  cashSeq: "7",
  source: "payment",
  receiptNumber: "SLM-R-2026-000045",
  spends: [{ creditId: CREDIT, amountMinor: "1500000" }],
};

const closing: CashClosingAuditSnapshot = {
  businessDate: "2026-10-21",
  fromCashSeq: "2",
  toCashSeq: "9",
  expectedMinor: "-700",
  countedMinor: "0",
  differenceMinor: "700",
  currency: "KWD",
  previousClosingId: null,
};

const refused = (entity: "refund" | "cash_closing", snapshot: object) => () =>
  assertFinanceAuditSnapshotShape(entity, snapshot as RefundAuditSnapshot);

describe("the refund audit snapshot", () => {
  it("accepts numbers, amounts and credit ids whole, from a payment or from credit", () => {
    expect(() => assertFinanceAuditSnapshotShape("refund", refund)).not.toThrow();
    const fromCredit: RefundAuditSnapshot = {
      refundNumber: refund.refundNumber,
      invoiceNumber: refund.invoiceNumber,
      method: "bank_transfer",
      amountMinor: "3000",
      currency: "KWD",
      cashSeq: null,
      source: "credit",
      spends: [{ creditId: CREDIT, amountMinor: "3000" }],
    };
    expect(() => assertFinanceAuditSnapshotShape("refund", fromCredit)).not.toThrow();
  });

  it("refuses free text where a number, a method or a source belongs", () => {
    expect(refused("refund", { ...refund, refundNumber: "returned to Sara" })).toThrow();
    expect(refused("refund", { ...refund, refundNumber: "SLM-R-2026-000001" })).toThrow();
    expect(refused("refund", { ...refund, method: "cheque" })).toThrow();
    expect(refused("refund", { ...refund, source: "gift" })).toThrow();
    expect(refused("refund", { ...refund, amountMinor: "-1" })).toThrow();
    expect(
      refused("refund", { ...refund, spends: [{ creditId: "Sara", amountMinor: "1" }] }),
    ).toThrow();
  });
});

describe("the cash closing audit snapshot", () => {
  it("accepts a signed expected amount and difference, and a first closing", () => {
    expect(() => assertFinanceAuditSnapshotShape("cash_closing", closing)).not.toThrow();
    const chained = { ...closing, previousClosingId: CREDIT, expectedMinor: "2500" };
    expect(() => assertFinanceAuditSnapshotShape("cash_closing", chained)).not.toThrow();
  });

  it("refuses a signed count, a free-text date and a note in place of an id", () => {
    expect(refused("cash_closing", { ...closing, countedMinor: "-1" })).toThrow();
    expect(refused("cash_closing", { ...closing, businessDate: "yesterday" })).toThrow();
    expect(
      refused("cash_closing", { ...closing, previousClosingId: "short by one coin" }),
    ).toThrow();
    expect(refused("cash_closing", { ...closing, differenceMinor: "about 700" })).toThrow();
  });
});
