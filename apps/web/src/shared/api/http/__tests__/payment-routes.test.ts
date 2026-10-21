import { beforeEach, describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { errorKeyOf } from "../../api-error";
import { BRANCH, CLINIC, TS, USER, clientWith, code, me, type Call } from "./fetch-stub";

// Finance F2 card 1 over HTTP: method, path, header, body and schema of every payment call.
const P: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };
const INVOICE = "0190a000-0000-7000-8000-0000000000d1";
const PAYMENT = "0190a000-0000-7000-8000-0000000000d2";
const PATIENT = "0190a000-0000-7000-8000-0000000000d3";
const CREDIT = "0190a000-0000-7000-8000-0000000000d4";
const settlement = { state: "partly_paid", paidMinor: "1000", owedMinor: "4000" };
const payment = {
  id: PAYMENT,
  receiptNumber: "TT-R-2026-000001",
  branchId: BRANCH,
  invoiceId: INVOICE,
  invoiceNumber: "TT-2026-000001",
  patientId: PATIENT,
  patientName: "مراجع تجريبي",
  method: "cash",
  amountMinor: "1000",
  currency: "KWD",
  currencyExponent: 3,
  reference: null,
  receivedAt: TS,
  businessDate: "2026-01-01",
  cashSeq: "1",
  receivedBy: USER,
};
const movements = {
  invoiceId: INVOICE,
  currency: "KWD",
  currencyExponent: 3,
  settlement,
  creditBalanceMinor: "0",
  movements: [],
};
const credit = {
  allocations: [{ id: PAYMENT, creditId: CREDIT, amountMinor: "500", createdAt: TS }],
  settlement,
  creditBalanceMinor: "0",
};
const methods = {
  paymentMethods: ["cash", "knet", "bank_transfer", "other"].map((method) => ({
    method,
    enabled: true,
  })),
};

let broken = false;
function answer(call: Call) {
  const path = call.url.replace(/\?.*$/, "");
  if (path === "/api/v1/me") return { body: me };
  if (broken) return { body: { nope: true } };
  if (path.endsWith("/payments") && path.includes("/invoices/")) {
    return call.method === "POST"
      ? { status: 201, body: { payment, settlement } }
      : { body: movements };
  }
  if (path.endsWith("/credit-applications")) return { status: 201, body: credit };
  if (path === "/api/v1/payments") return { body: { items: [payment], nextCursor: null, total: 1 } };
  if (path === `/api/v1/payments/${PAYMENT}`) return { body: { payment } };
  if (path === "/api/v1/clinic/settings/payment-methods") return { body: methods };
  return { status: 404, body: {} };
}

let h: ReturnType<typeof clientWith>;
beforeEach(() => {
  broken = false;
  h = clientWith(answer);
});
const last = () => h.calls.at(-1)!;

describe("payments over HTTP", () => {
  it("reads an invoice's movements", async () => {
    expect(await h.api.payments.invoicePayments(P, INVOICE)).toEqual(movements);
    expect(last()).toMatchObject({ method: "GET", url: `/api/v1/invoices/${INVOICE}/payments` });
  });

  it("records a payment with the Idempotency-Key and only the contract's body", async () => {
    const body = { method: "cash" as const, amountMinor: "1000" };
    expect((await h.api.payments.recordPayment(P, INVOICE, body, "key-1")).payment).toEqual(payment);
    expect(last()).toMatchObject({
      method: "POST",
      url: `/api/v1/invoices/${INVOICE}/payments`,
      body,
    });
    expect(last().headers["Idempotency-Key"]).toBe("key-1");
  });

  it("applies credit with the Idempotency-Key", async () => {
    expect(await h.api.payments.applyCredit(P, INVOICE, { amountMinor: "500" }, "key-2")).toEqual(
      credit,
    );
    expect(last()).toMatchObject({
      method: "POST",
      url: `/api/v1/invoices/${INVOICE}/credit-applications`,
      body: { amountMinor: "500" },
    });
    expect(last().headers["Idempotency-Key"]).toBe("key-2");
  });

  it("lists receipts with the query and reads one receipt", async () => {
    await h.api.payments.listPayments(P, { limit: 20, method: "knet", from: "2026-01-01" });
    expect(last().url).toBe("/api/v1/payments?limit=20&method=knet&from=2026-01-01");
    expect(await h.api.payments.getPayment(P, PAYMENT)).toEqual(payment);
    expect(last().url).toBe(`/api/v1/payments/${PAYMENT}`);
  });

  it("saves the payment methods with PUT and the whole list", async () => {
    expect(await h.api.finance.setPaymentMethods(P, methods.paymentMethods as never)).toEqual(
      methods,
    );
    expect(last()).toMatchObject({
      method: "PUT",
      url: "/api/v1/clinic/settings/payment-methods",
      body: methods,
    });
  });

  it("passes the invoice list's settlement filter through", async () => {
    await h.api.finance.listInvoices(P, { settlement: "partly_paid" }).catch(() => undefined);
    expect(last().url).toBe("/api/v1/invoices?settlement=partly_paid");
  });

  it("refuses an answer outside its contract", async () => {
    broken = true;
    expect((await code(h.api.payments.invoicePayments(P, INVOICE))).code).toBe("unknown");
  });

  it("hands an F2 refusal on as its own i18n key", async () => {
    const refusing = clientWith((call) =>
      call.url.startsWith("/api/v1/me")
        ? { body: me }
        : {
            status: 422,
            body: { code: "payment_exceeds_balance", message_ar: "م", message_en: "m" },
          },
    );
    const error = await refusing.api.payments
      .recordPayment(P, INVOICE, { method: "cash", amountMinor: "1" }, "k")
      .catch((e: unknown) => e);
    expect(errorKeyOf(error)).toBe("payment_exceeds_balance");
  });
});
