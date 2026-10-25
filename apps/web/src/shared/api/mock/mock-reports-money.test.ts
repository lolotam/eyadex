import { beforeEach, describe, expect, it } from "vitest";
import { resetMockData } from "./mock-test-kit";
import { clinicFinanceOf, financeState } from "./mock-finance-state";
import { paymentState } from "./mock-payment-state";
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
  today,
} from "./mock-report-test-kit";

beforeEach(() => resetMockData());

const refundFrom = (invoiceId: string, paymentId: string, amountMinor: string) =>
  api.payments.refund(
    admin(),
    invoiceId,
    { source: "payment", paymentId, amountMinor, method: "cash", reason: "اختبار" },
    crypto.randomUUID(),
  );

/** One invoice of 10.000 paid 4.000 in cash, 1.000 refunded from that receipt. */
async function story() {
  const invoice = await issue([freeLine("10000")]);
  const { payment } = await pay(invoice.id, "4000");
  await refundFrom(invoice.id, payment.id, "1000");
  return { invoice, payment };
}

describe("R1 and R2 on the mock's movements", () => {
  it("R1 takes the receipt in and the refund out, per day, branch and method", async () => {
    const { invoice } = await story();
    const r1 = await api.reports.dailyTakings(admin(), range());
    expect(r1.rows).toEqual([
      expect.objectContaining({
        period: today(),
        branchId: invoice.branchId,
        method: "cash",
        inMinor: "4000",
        outMinor: "1000",
        netMinor: "3000",
      }),
    ]);
    expect(r1.totals).toEqual({ inMinor: "4000", outMinor: "1000", netMinor: "3000" });
    expect(r1.currency).toBe("KWD");
  });

  it("grouping by month rolls the day into its month", async () => {
    await story();
    const r1 = await api.reports.dailyTakings(admin(), { ...range(), groupBy: "month" });
    expect(r1.rows.map((r) => r.period)).toEqual([today().slice(0, 7)]);
  });

  it("R2 counts a void invoice only in its void count, and credit applied apart from collected", async () => {
    await story();
    const voided = await issue([freeLine("2000")]);
    await pay(voided.id, "2000");
    const v = await api.finance.getInvoice(admin(), voided.id);
    await api.finance.voidInvoice(admin(), voided.id, v.version, "اختبار");
    const third = await issue([freeLine("500")]);
    await api.payments.applyCredit(admin(), third.id, { amountMinor: "500" }, crypto.randomUUID());
    const r2 = await api.reports.periodSummary(admin(), range());
    expect(r2.totals).toEqual({
      invoicedMinor: "10500",
      discountMinor: "0",
      taxMinor: "0",
      collectedMinor: "6000",
      refundedMinor: "1000",
      creditAppliedMinor: "500",
      voidCount: 1,
    });
  });
});

describe("R3 and R4", () => {
  it("free lines are one row, lines with no doctor one row, and their totals add up", async () => {
    await issue([freeLine("3000"), freeLine("2000")]);
    const r3 = await api.reports.byService(admin(), range());
    expect(r3.rows).toEqual([
      expect.objectContaining({ kind: "free", lineCount: 2, quantity: 2, amountMinor: "5000" }),
    ]);
    expect(r3.totals).toMatchObject({ billedMinor: "5000", taxMinor: "0", totalMinor: "5000" });
    const r4 = await api.reports.byDoctor(admin(), range());
    expect(r4.rows).toEqual([
      expect.objectContaining({ kind: "none", providerId: null, amountMinor: "5000" }),
    ]);
  });

  it("the tax is a row of its own, in the total but not in the billed lines", async () => {
    clinicFinanceOf(getState(), getState().clinics[0]!.id).taxRateBp = 1000;
    await issue([freeLine("10000")]);
    const r3 = await api.reports.byService(admin(), range());
    expect(r3.rows.at(-1)).toMatchObject({ kind: "tax", amountMinor: "1000", lineCount: 0 });
    expect(r3.totals).toMatchObject({
      billedMinor: "10000",
      taxMinor: "1000",
      totalMinor: "11000",
    });
  });
});

describe("R9", () => {
  it("lists a saved closing with its difference and its author's name", async () => {
    const { invoice } = await story();
    const preview = await api.cashClosings.preview(admin(), invoice.branchId);
    await api.cashClosings.close(
      admin(),
      {
        branchId: invoice.branchId,
        previousClosingId: preview.previousClosingId,
        throughCashSeq: preview.throughCashSeq,
        countedMinor: "2500",
        note: "عجز",
      },
      crypto.randomUUID(),
    );
    const r9 = await api.reports.cashClosings(admin(), range());
    expect(r9.rows).toEqual([
      expect.objectContaining({
        expectedMinor: "3000",
        countedMinor: "2500",
        differenceMinor: "-500",
        closedByName: memberOf("clinic_admin").fullName,
        notePresent: true,
      }),
    ]);
  });
});

describe("slice 2b fields on the mock", () => {
  it("an issued invoice keeps its day and a payment's allocation the payment's day, out of the answers", async () => {
    const { invoice, payment } = await story();
    const stored = financeState(getState()).invoices.find((i) => i.id === invoice.id)!;
    expect(stored.businessDate).toBe(today());
    const allocation = paymentState(getState()).allocations.find((a) => a.paymentId === payment.id);
    expect(allocation?.businessDate).toBe(payment.businessDate);
    const answer = await api.finance.getInvoice(admin(), invoice.id);
    expect(Object.keys(answer)).not.toContain("businessDate");
    expect(Object.keys(answer)).not.toContain("lineMeta");
    expect(Object.keys(answer)).not.toContain("discountedBy");
  });

  it("a credit application's allocation takes its own day", async () => {
    const paid = await issue([freeLine("2000")], patientAt());
    await pay(paid.id, "2000");
    const v = await api.finance.getInvoice(admin(), paid.id);
    await api.finance.voidInvoice(admin(), paid.id, v.version, "اختبار");
    const next = await issue([freeLine("700")]);
    await api.payments.applyCredit(admin(), next.id, { amountMinor: "700" }, crypto.randomUUID());
    const applied = paymentState(getState()).allocations.find((a) => a.invoiceId === next.id);
    expect(applied?.creditId).not.toBeNull();
    expect(applied?.businessDate).toBe(today());
  });
});
