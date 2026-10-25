import { beforeEach, describe, expect, it } from "vitest";
import { resetMockData } from "./mock-test-kit";
import { ageBucket } from "./mock-report-balances";
import { financeState } from "./mock-finance-state";
import { createMockReports } from "./mock-reports";
import {
  admin,
  api,
  freeLine,
  getState,
  issue,
  memberOf,
  pay,
  patientAt,
  range,
} from "./mock-report-test-kit";

beforeEach(() => resetMockData());

const voidIt = async (id: string) => {
  const v = await api.finance.getInvoice(admin(), id);
  return api.finance.voidInvoice(admin(), id, v.version, "اختبار");
};

describe("R5 outstanding", () => {
  it("lists issued invoices still owing, with what is paid and owed, and the summary", async () => {
    const owing = await issue([freeLine("10000")]);
    await pay(owing.id, "4000");
    const paid = await issue([freeLine("1000")]);
    await pay(paid.id, "1000");
    const r5 = await api.reports.outstanding(admin(), range());
    expect(r5.items).toEqual([
      expect.objectContaining({
        invoiceId: owing.id,
        totalMinor: "10000",
        paidMinor: "4000",
        owedMinor: "6000",
        ageBucket: "0_30",
        patientName: patientAt().fullName,
      }),
    ]);
    expect(r5.summary).toEqual([
      { ageBucket: "0_30", branchId: owing.branchId, invoiceCount: 1, owedMinor: "6000" },
    ]);
  });

  it("ages from the issue day to the clinic's today", async () => {
    expect(ageBucket("2026-01-01", "2026-01-31")).toBe("0_30");
    expect(ageBucket("2026-01-01", "2026-02-01")).toBe("31_60");
    expect(ageBucket("2026-01-01", "2026-03-02")).toBe("31_60");
    expect(ageBucket("2026-01-01", "2026-03-03")).toBe("61_90");
    expect(ageBucket("2026-01-01", "2026-04-01")).toBe("61_90");
    expect(ageBucket("2026-01-01", "2026-04-02")).toBe("over_90");
    await issue([freeLine("500")]);
    const later = createMockReports(() => new Date(Date.now() + 45 * 86_400_000));
    const r5 = await later.outstanding(admin(), range());
    expect(r5.items[0]?.ageBucket).toBe("31_60");
  });

  it("pages newest first; the total and the summary ignore the cursor", async () => {
    for (const amount of ["100", "200", "300"]) await issue([freeLine(amount)]);
    const first = await api.reports.outstanding(admin(), { ...range(), limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(3);
    const second = await api.reports.outstanding(admin(), {
      ...range(),
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.summary[0]?.invoiceCount).toBe(3);
    const ids = [...first.items, ...second.items].map((i) => i.invoiceId);
    expect(ids).toEqual([...ids].sort().reverse());
  });
});

describe("R6 patient credit", () => {
  it("counts only the credit still available", async () => {
    const paid = await issue([freeLine("2000")]);
    await pay(paid.id, "2000");
    await voidIt(paid.id);
    const next = await issue([freeLine("500")]);
    await api.payments.applyCredit(admin(), next.id, { amountMinor: "500" }, crypto.randomUUID());
    const r6 = await api.reports.patientCredit(admin(), range());
    expect(r6.items).toEqual([
      expect.objectContaining({ patientId: patientAt().id, balanceMinor: "1500" }),
    ]);
  });
});

describe("R7 refunds and R8 discounts", () => {
  it("walks every legacy discount exactly once with limit 1, with stable cursors", async () => {
    const amount = (minor: string) => ({ kind: "amount" as const, minor, reason: minor });
    for (const suffix of ["00", "01"]) {
      const invoice = await issue(
        [freeLine("10000", amount("1000")), freeLine("5000", amount("500"))],
        patientAt(),
        amount("100"),
      );
      const stored = financeState(getState()).invoices.find((i) => i.id === invoice.id)!;
      stored.id = `00000000-0000-7000-8000-0000000001${suffix}`;
      delete stored.lineMeta;
    }
    const expected = await api.reports.discounts(admin(), range());
    expect(expected.total).toBe(6);
    const items: typeof expected.items = [];
    let cursor: string | undefined;
    do {
      const page = await api.reports.discounts(admin(), { ...range(), limit: 1, cursor });
      expect(page.total).toBe(6);
      expect(page.items).toHaveLength(1);
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      expect(items.length).toBeLessThanOrEqual(6);
    } while (cursor !== undefined);
    expect(items).toEqual(expected.items);
    expect(new Set(items.map((r) => `${r.invoiceId}|${r.kind}|${r.reason}`)).size).toBe(6);
    const repeated = await api.reports.discounts(admin(), { ...range(), limit: 1 });
    const first = await api.reports.discounts(admin(), { ...range(), limit: 1 });
    expect(repeated.nextCursor).toBe(first.nextCursor);
  });

  it("a receipt refund is source payment, a credit refund source credit", async () => {
    const a = await issue([freeLine("3000")]);
    const { payment } = await pay(a.id, "3000");
    await api.payments.refund(
      admin(),
      a.id,
      {
        source: "payment",
        paymentId: payment.id,
        amountMinor: "1000",
        method: "cash",
        reason: "أ",
      },
      crypto.randomUUID(),
    );
    await voidIt(a.id);
    await api.payments.refund(
      admin(),
      a.id,
      { source: "credit", amountMinor: "500", method: "cash", reason: "ب" },
      crypto.randomUUID(),
    );
    const r7 = await api.reports.refunds(admin(), range());
    const sources = Object.fromEntries(r7.items.map((r) => [r.reason, r.source]));
    expect(sources).toEqual({ أ: "payment", ب: "credit" });
    expect(r7.items[0]?.refundedByName).toBe(memberOf("clinic_admin").fullName);
  });

  it("one row per discounted line and one for the invoice's own discount, with its author", async () => {
    const amount = (minor: string) => ({ kind: "amount" as const, minor, reason: "خصم" });
    const invoice = await issue(
      [freeLine("10000", amount("1000")), freeLine("5000")],
      patientAt(),
      { kind: "pct", bp: 1000, reason: "عام" },
    );
    const r8 = await api.reports.discounts(admin(), range());
    const byKind = Object.fromEntries(r8.items.map((r) => [r.kind, r]));
    expect(byKind["line"]).toMatchObject({ discountMinor: "1000", reason: "خصم" });
    expect(BigInt(byKind["invoice"]!.discountMinor)).toBe(BigInt(invoice.discountMinor) - 1000n);
    for (const row of r8.items) {
      expect(row.discountedBy).toBe(memberOf("clinic_admin").id);
      expect(row.discountedByName).toBe(memberOf("clinic_admin").fullName);
    }
  });
});
