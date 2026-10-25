import { beforeEach, expect, it } from "vitest";
import { financeState } from "./mock-finance-state";
import { paymentState } from "./mock-payment-state";
import { resetMockData } from "./mock-test-kit";
import {
  admin,
  api,
  clinic,
  freeLine,
  getState,
  issue,
  pay,
  patientAt,
} from "./mock-report-test-kit";

beforeEach(() => resetMockData());

const instant = "2026-10-01T22:30:00.000Z";
const october1 = { from: "2026-10-01", to: "2026-10-01" };
const october2 = { from: "2026-10-02", to: "2026-10-02" };

it("R2 derives a credit allocation's day from createdAt in the current clinic timezone", async () => {
  clinic().timezone = "Asia/Kuwait";
  const paid = await issue([freeLine("2000")]);
  await pay(paid.id, "2000");
  const current = await api.finance.getInvoice(admin(), paid.id);
  await api.finance.voidInvoice(admin(), paid.id, current.version, "اختبار");
  const next = await issue([freeLine("700")]);
  await api.payments.applyCredit(admin(), next.id, { amountMinor: "700" }, crypto.randomUUID());
  const allocation = paymentState(getState()).allocations.find((a) => a.invoiceId === next.id)!;
  allocation.createdAt = instant;
  allocation.businessDate = "2026-10-02";
  expect((await api.reports.periodSummary(admin(), october2)).totals.creditAppliedMinor).toBe(
    "700",
  );
  expect((await api.reports.periodSummary(admin(), october1)).totals.creditAppliedMinor).toBe("0");

  clinic().timezone = "UTC";
  const report = await api.reports.periodSummary(admin(), { ...october1, groupBy: "day" });
  expect(report.rows).toEqual([
    expect.objectContaining({ period: "2026-10-01", creditAppliedMinor: "700" }),
  ]);
  expect(report.totals.creditAppliedMinor).toBe("700");
  expect((await api.reports.periodSummary(admin(), october2)).totals.creditAppliedMinor).toBe("0");
  expect(allocation.businessDate).toBe("2026-10-02");
});

it("invoice reports derive the day from issuedAt after a timezone change, keeping the stored day", async () => {
  clinic().timezone = "Asia/Kuwait";
  const invoice = await issue(
    [freeLine("10000", { kind: "amount", minor: "1000", reason: "خصم" })],
    patientAt(),
  );
  const stored = financeState(getState()).invoices.find((i) => i.id === invoice.id)!;
  stored.issuedAt = instant;
  stored.businessDate = "2026-10-02";
  expect((await api.reports.outstanding(admin(), october2)).total).toBe(1);
  clinic().timezone = "UTC";

  expect((await api.reports.periodSummary(admin(), october1)).totals.invoicedMinor).toBe("9000");
  expect((await api.reports.byService(admin(), october1)).totals.billedMinor).toBe("9000");
  expect((await api.reports.byDoctor(admin(), october1)).totals.billedMinor).toBe("9000");
  expect((await api.reports.outstanding(admin(), october1)).items).toEqual([
    expect.objectContaining({ invoiceId: invoice.id, businessDate: "2026-10-01" }),
  ]);
  expect((await api.reports.discounts(admin(), october1)).items).toEqual([
    expect.objectContaining({ invoiceId: invoice.id, businessDate: "2026-10-01" }),
  ]);
  expect((await api.reports.periodSummary(admin(), october2)).rows).toEqual([]);
  expect((await api.reports.byService(admin(), october2)).rows).toEqual([]);
  expect((await api.reports.byDoctor(admin(), october2)).rows).toEqual([]);
  expect((await api.reports.outstanding(admin(), october2)).items).toEqual([]);
  expect((await api.reports.discounts(admin(), october2)).items).toEqual([]);
  expect(stored.businessDate).toBe("2026-10-02");
});
