import { describe, expect, it } from "vitest";
import { settlementBreaches } from "@eyadex/contracts/settlement";
import { financeState } from "./mock-finance-state";
import { moneyOf, paymentState } from "./mock-payment-state";
import { settlementInvoice, settlementOf } from "./mock-settlement";
import { buildSeed } from "./seed";
import { seedFinanceDemo } from "./seed-finance";

describe("the finance demo seed", () => {
  it("gives every branch of a finance clinic a partly paid invoice, receipts and a credit", () => {
    const db = buildSeed();
    seedFinanceDemo(db);
    const invoices = financeState(db).invoices;
    const branches = new Set(invoices.map((i) => i.branchId));
    expect(branches.size).toBeGreaterThan(0);
    for (const branchId of branches) {
      const mine = invoices.filter((i) => i.branchId === branchId);
      expect(mine.map((i) => settlementOf(db, i)?.state ?? "void").sort()).toEqual(
        ["paid", "partly_paid", "void"].sort(),
      );
    }
    const s = paymentState(db);
    expect(s.payments.length).toBe(branches.size * 3);
    expect(s.credits.length).toBe(branches.size);
    for (const p of new Set(invoices.map((i) => i.patientId))) {
      const clinicId = invoices[0]!.clinicId;
      const own = invoices.filter((i) => i.patientId === p).map(settlementInvoice);
      expect(settlementBreaches(moneyOf(db, clinicId, p), own)).toEqual([]);
    }
  });
});
