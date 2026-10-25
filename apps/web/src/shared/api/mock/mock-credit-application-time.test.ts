import { dayInTimeZone } from "@eyadex/contracts/audit";
import { beforeEach, expect, it } from "vitest";
import { paymentState } from "./mock-payment-state";
import { applyCredit } from "./mock-payment-writes";
import { resetMockData } from "./mock-test-kit";
import { admin, api, clinic, freeLine, getState, issue, pay } from "./mock-report-test-kit";

beforeEach(() => resetMockData());

it("a two-lot credit application shares one instant and clinic day at midnight", async () => {
  clinic().timezone = "Asia/Kuwait";
  for (const amount of ["1000", "2000"]) {
    const source = await issue([freeLine(amount)]);
    await pay(source.id, amount);
    const current = await api.finance.getInvoice(admin(), source.id);
    await api.finance.voidInvoice(admin(), source.id, current.version, "اختبار");
  }
  const invoice = await issue([freeLine("3000")]);
  // Date retains milliseconds; the API's sub-millisecond instant is the last representable ms here.
  const at = new Date("2026-10-01T20:59:59.9995Z");
  const result = applyCredit(
    getState(),
    admin(),
    invoice.id,
    { amountMinor: "3000" },
    crypto.randomUUID(),
    at,
  );
  const allocations = paymentState(getState()).allocations.filter(
    (a) => a.invoiceId === invoice.id,
  );
  expect(allocations).toHaveLength(2);
  for (const allocation of allocations) {
    expect(allocation.createdAt).toBe(at.toISOString());
    expect(allocation.businessDate).toBe("2026-10-01");
    expect(dayInTimeZone(allocation.createdAt, clinic().timezone)).toBe("2026-10-01");
  }
  expect(new Set(result.allocations.map((a) => a.id)).size).toBe(2);
  expect(result.creditBalanceMinor).toBe("0");
  expect(result.settlement).toMatchObject({ state: "paid", paidMinor: "3000", owedMinor: "0" });
});
