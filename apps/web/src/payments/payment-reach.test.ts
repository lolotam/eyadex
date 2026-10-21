import { beforeEach, describe, expect, it } from "vitest";
import {
  PAYMENT_METHODS,
  invoicePaymentsResponseSchema,
  paymentListResponseSchema,
} from "@eyadex/contracts/finance";
import { clinicFinanceOf } from "@/shared/api/mock/mock-finance-state";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { checkAmount } from "./payment-amount";
import {
  admin,
  api,
  as,
  clinicIdAt,
  clinicPatients,
  getState,
  issue,
  pay,
  refusal,
  roleOf,
} from "./payment-mock-kit";

beforeEach(() => resetMockData());

const twoBranches = () => {
  const a = clinicPatients()[0]!;
  const b = clinicPatients().find((p) => p.registrationBranchId !== a.registrationBranchId)!;
  return { a, b };
};

describe("who reaches payments (F2-Q8)", () => {
  it("a doctor with only view:invoices:own sees the settlement but movements are forbidden", async () => {
    const invoice = await issue("5000");
    const { role } = roleOf("doctor");
    role.permissions = ["view:invoices:own"];
    expect(await refusal(api.payments.invoicePayments(as("doctor"), invoice.id))).toBe("forbidden");
  });

  it("a custom role with create:payments but no view:invoices may still record a payment", async () => {
    const invoice = await issue("5000");
    const { role } = roleOf("technician");
    role.permissions = ["create:payments:clinic"];
    const answer = await pay(invoice.id, "1000", "cash", as("technician"));
    expect(answer.settlement.owedMinor).toBe("4000");
  });

  it("NEGATIVE: view:payments:branch of another branch is not_found, and its receipts are hidden", async () => {
    const { a, b } = twoBranches();
    const invoice = await issue("5000", a);
    await pay(invoice.id, "1000");
    const { role, member } = roleOf("receptionist");
    role.permissions = ["view:payments:branch", "create:payments:branch"];
    member.allBranches = false;
    member.branchIds = [b.registrationBranchId];
    const desk = as("receptionist");
    expect(await refusal(api.payments.invoicePayments(desk, invoice.id))).toBe("not_found");
    expect(await refusal(pay(invoice.id, "100", "cash", desk))).toBe("not_found");
    const list = await api.payments.listPayments(desk, {});
    expect(list.items).toEqual([]);
    const receipt = (await api.payments.listPayments(admin(), {})).items[0]!;
    expect(await refusal(api.payments.getPayment(desk, receipt.id))).toBe("not_found");
  });

  it("answers pass their contracts and list receipts newest first in cursor pages", async () => {
    const invoice = await issue("5000");
    await pay(invoice.id, "100");
    await pay(invoice.id, "200", "knet");
    const first = await api.payments.listPayments(admin(), { limit: 1 });
    expect(paymentListResponseSchema.safeParse(first).success).toBe(true);
    expect(first.items[0]!.amountMinor).toBe("200");
    const second = await api.payments.listPayments(admin(), { limit: 1, cursor: first.nextCursor! });
    expect(second.items[0]!.amountMinor).toBe("100");
    const view = await api.payments.invoicePayments(admin(), invoice.id);
    expect(invoicePaymentsResponseSchema.safeParse(view).success).toBe(true);
  });
});

describe("the method switches reach the payment", () => {
  it("a method turned off in the settings is refused as payment_method_disabled", async () => {
    const invoice = await issue("5000");
    await api.finance.setPaymentMethods(
      admin(),
      PAYMENT_METHODS.map((method) => ({ method, enabled: method !== "knet" })),
    );
    expect(await refusal(pay(invoice.id, "100", "knet"))).toBe("payment_method_disabled");
    expect((await pay(invoice.id, "100", "cash")).payment.method).toBe("cash");
  });
});

describe("amounts in the clinic's currency", () => {
  it("reads major units into minor units for KWD (3) and SAR (2)", () => {
    expect(checkAmount("12.5", 3, { owedMinor: "99999" })).toEqual({ ok: true, amountMinor: "12500" });
    expect(checkAmount("12.5", 2, { owedMinor: "99999" })).toEqual({ ok: true, amountMinor: "1250" });
    expect(checkAmount("12.345", 2, { owedMinor: "99999" })).toMatchObject({ ok: false });
    expect(checkAmount("0", 3, { owedMinor: "1" })).toEqual({ ok: false, error: "amountInvalid" });
  });

  it("refuses before sending above the balance or the credit", () => {
    expect(checkAmount("6", 3, { owedMinor: "5000" })).toMatchObject({
      error: "payment_exceeds_balance",
    });
    expect(checkAmount("2", 3, { owedMinor: "5000", creditMinor: "1000" })).toMatchObject({
      error: "credit_insufficient",
    });
  });

  it("a SAR clinic's receipt carries exponent 2 and its amount round-trips", async () => {
    clinicFinanceOf(getState(), clinicIdAt(0)).currency = "SAR";
    const invoice = await issue("1250");
    const answer = await pay(invoice.id, "1250");
    expect(answer.payment).toMatchObject({ currency: "SAR", currencyExponent: 2, amountMinor: "1250" });
    expect(answer.settlement.state).toBe("paid");
  });
});
