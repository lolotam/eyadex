import { beforeEach, describe, expect, it } from "vitest";
import { financeState } from "@/shared/api/mock/mock-finance-state";
import { paymentState } from "@/shared/api/mock/mock-payment-state";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import {
  admin,
  api,
  applyCredit,
  clinicIdAt,
  getState,
  issue,
  pay,
  refusal,
  roleOf,
  as,
  voidIt,
} from "./payment-mock-kit";

beforeEach(() => resetMockData());

const UNKNOWN_INVOICE = "00000000-0000-7000-8000-0000000000ff";
const clinic = () => getState().clinics.find((c) => c.id === clinicIdAt(0))!;
const financeOff = () => (getState().features[clinicIdAt(0)]!.finance = false);
const methodOff = (method: "cash") => (paymentState(getState()).methods[clinicIdAt(0)] = { [method]: false });
const noPaymentKeys = () => {
  const { role } = roleOf("receptionist");
  role.permissions = role.permissions.filter((k) => !k.includes(":payments:"));
};
const record = (invoiceId: string, body: unknown, key = crypto.randomUUID()) =>
  api.payments.recordPayment(admin(), invoiceId, body as never, key);

// Spec §4.6 / card §6: each test sets up two refusals at once, so it fails if the two steps swap.
describe("record payment refuses in the API's order", () => {
  it("subscription_blocked before module_disabled", async () => {
    clinic().status = "suspended";
    financeOff();
    expect(await refusal(pay(UNKNOWN_INVOICE, "1"))).toBe("subscription_blocked");
  });

  it("module_disabled before forbidden", async () => {
    financeOff();
    noPaymentKeys();
    expect(await refusal(pay(UNKNOWN_INVOICE, "1", "cash", as("receptionist")))).toBe(
      "module_disabled",
    );
  });

  it("forbidden (no payments key in any scope) before the body is read", async () => {
    noPaymentKeys();
    const bad = api.payments.recordPayment(as("receptionist"), UNKNOWN_INVOICE, {} as never, "");
    expect(await refusal(bad)).toBe("forbidden");
  });

  it("a bad body is validation, and so is a missing key with a good body", async () => {
    expect(await refusal(record(UNKNOWN_INVOICE, { method: "cash", amountMinor: "0" }))).toBe(
      "validation",
    );
    expect(await refusal(record(UNKNOWN_INVOICE, { method: "cash", amountMinor: "1" }, ""))).toBe(
      "validation",
    );
  });

  it("the key is checked before the invoice is looked up", async () => {
    expect(await refusal(record(UNKNOWN_INVOICE, { method: "cash", amountMinor: "1" }, " "))).toBe(
      "validation",
    );
  });

  it("idempotency before not_found: a used key on an unknown invoice is a conflict", async () => {
    const invoice = await issue("5000");
    const key = crypto.randomUUID();
    await pay(invoice.id, "1000", "cash", admin(), key);
    expect(await refusal(pay(UNKNOWN_INVOICE, "1000", "cash", admin(), key))).toBe(
      "idempotency_conflict",
    );
  });

  it("not_found before payment_method_disabled", async () => {
    methodOff("cash");
    expect(await refusal(pay(UNKNOWN_INVOICE, "1"))).toBe("not_found");
  });

  it("payment_method_disabled before invoice_void", async () => {
    const invoice = await issue("5000");
    await voidIt(invoice.id);
    methodOff("cash");
    expect(await refusal(pay(invoice.id, "1"))).toBe("payment_method_disabled");
  });

  it("invoice_void before invoice_settled", async () => {
    const invoice = await issue("0");
    await voidIt(invoice.id);
    expect(await refusal(pay(invoice.id, "1"))).toBe("invoice_void");
  });

  it("invoice_settled before payment_exceeds_balance", async () => {
    const invoice = await issue("1000");
    await pay(invoice.id, "1000");
    expect(await refusal(pay(invoice.id, "5000"))).toBe("invoice_settled");
  });

  it("payment_exceeds_balance before invoice_prefix_missing, then the prefix", async () => {
    const invoice = await issue("1000");
    delete financeState(getState()).prefixes[invoice.branchId];
    expect(await refusal(pay(invoice.id, "2000"))).toBe("payment_exceeds_balance");
    expect(await refusal(pay(invoice.id, "500"))).toBe("invoice_prefix_missing");
  });
});

describe("apply credit refuses in the API's order", () => {
  it("invoice_void before invoice_settled", async () => {
    const invoice = await issue("0");
    await voidIt(invoice.id);
    expect(await refusal(applyCredit(invoice.id, "1"))).toBe("invoice_void");
  });

  it("invoice_settled before payment_exceeds_balance", async () => {
    const invoice = await issue("0");
    expect(await refusal(applyCredit(invoice.id, "1"))).toBe("invoice_settled");
  });

  it("payment_exceeds_balance before credit_insufficient, then the credit", async () => {
    const invoice = await issue("5000");
    expect(await refusal(applyCredit(invoice.id, "6000"))).toBe("payment_exceeds_balance");
    expect(await refusal(applyCredit(invoice.id, "1000"))).toBe("credit_insufficient");
  });

  it("a refused write leaves no movement and no audit row", async () => {
    const invoice = await issue("5000");
    const rows = getState().clinicAudit.length;
    await refusal(pay(invoice.id, "6000"));
    await refusal(applyCredit(invoice.id, "1000"));
    const s = paymentState(getState());
    expect([s.payments.length, s.allocations.length, s.credits.length]).toEqual([0, 0, 0]);
    expect(getState().clinicAudit.length).toBe(rows);
  });
});
