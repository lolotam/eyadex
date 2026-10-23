import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_MINOR } from "@eyadex/contracts/money";
import { paymentState } from "@/shared/api/mock/mock-payment-state";
import { getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { admin, api, issue, pay, patientAt, refusal } from "./closing-mock-kit";

beforeEach(() => {
  resetMockData();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-10T09:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const branch = () => patientAt().registrationBranchId;
/** Pushes a cash payment past the contract's range, so the drawer's sums are out of range. */
const inflate = (paymentId: string) => {
  const p = paymentState(getState()).payments.find((x) => x.id === paymentId)!;
  p.amountMinor = String(MAX_MINOR + 1n);
};
const closeAt = (previousClosingId: string | null, throughCashSeq: string) =>
  api.cashClosings.close(
    admin(),
    { branchId: branch(), previousClosingId, throughCashSeq, countedMinor: "0", note: "x" },
    crypto.randomUUID(),
  );

describe("cash_drawer_out_of_range comes after changed and exists (API order)", () => {
  it("a stale position is cash_drawer_changed, even when the sums are out of range", async () => {
    const invoice = await issue("10000");
    const p = (await pay(invoice.id, "1000", "cash")).payment;
    inflate(p.id);
    expect(await refusal(closeAt(null, "0"))).toBe("cash_drawer_changed");
    expect(await refusal(closeAt(null, p.cashSeq!))).toBe("cash_drawer_out_of_range");
  });

  it("a day already closed is cash_closing_exists, even when the sums are out of range", async () => {
    const invoice = await issue("10000");
    await pay(invoice.id, "1000", "cash");
    const pv = await api.cashClosings.preview(admin(), branch());
    const first = await closeAt(null, pv.throughCashSeq);
    const p2 = (await pay(invoice.id, "1000", "cash")).payment;
    inflate(p2.id);
    expect(await refusal(closeAt(first.id, p2.cashSeq!))).toBe("cash_closing_exists");
  });
});
