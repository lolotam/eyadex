import { beforeEach, describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { BRANCH, CLINIC, TS, USER, clientWith, code, me, type Call } from "./fetch-stub";

// Finance F2 card 2a over HTTP: method, path, header, body and schema of every refund call.
const P: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };
const INVOICE = "0190a000-0000-7000-8000-0000000000e1";
const PAYMENT = "0190a000-0000-7000-8000-0000000000e2";
const PATIENT = "0190a000-0000-7000-8000-0000000000e3";
const REFUND = "0190a000-0000-7000-8000-0000000000e4";
const refund = {
  id: REFUND,
  refundNumber: "TT-RF-2026-000001",
  branchId: BRANCH,
  invoiceId: INVOICE,
  invoiceNumber: "TT-2026-000001",
  patientId: PATIENT,
  patientName: "مراجع تجريبي",
  method: "cash",
  amountMinor: "500",
  currency: "KWD",
  currencyExponent: 3,
  reason: "سبب",
  refundedAt: TS,
  businessDate: "2026-01-01",
  cashSeq: "2",
  refundedBy: USER,
};
const write = { refund, settlement: null, creditBalanceMinor: "0" };

let broken = false;
function answer(call: Call) {
  const path = call.url.replace(/\?.*$/, "");
  if (path === "/api/v1/me") return { body: me };
  if (broken) return { body: { nope: true } };
  if (path === `/api/v1/invoices/${INVOICE}/refunds`) return { status: 201, body: write };
  if (path === "/api/v1/refunds") return { body: { items: [refund], nextCursor: null, total: 1 } };
  if (path === `/api/v1/refunds/${REFUND}`) return { body: { refund } };
  return { status: 404, body: {} };
}

let h: ReturnType<typeof clientWith>;
beforeEach(() => {
  broken = false;
  h = clientWith(answer);
});
const last = () => h.calls.at(-1)!;

describe("refunds over HTTP", () => {
  it("records a refund with the Idempotency-Key and only the contract's body", async () => {
    const body = {
      source: "payment" as const,
      paymentId: PAYMENT,
      amountMinor: "500",
      method: "cash" as const,
      reason: "سبب",
    };
    expect(await h.api.payments.refund(P, INVOICE, body, "key-r")).toEqual(write);
    expect(last()).toMatchObject({
      method: "POST",
      url: `/api/v1/invoices/${INVOICE}/refunds`,
      body,
    });
    expect(last().headers["Idempotency-Key"]).toBe("key-r");
  });

  it("lists refunds with the query and reads one refund", async () => {
    await h.api.payments.listRefunds(P, { limit: 20, method: "cash", to: "2026-01-31" });
    expect(last().url).toBe("/api/v1/refunds?limit=20&method=cash&to=2026-01-31");
    expect(await h.api.payments.getRefund(P, REFUND)).toEqual(refund);
    expect(last().url).toBe(`/api/v1/refunds/${REFUND}`);
  });

  it("refuses refund answers outside their contract", async () => {
    broken = true;
    expect((await code(h.api.payments.listRefunds(P, {}))).code).toBe("unknown");
    expect((await code(h.api.payments.getRefund(P, REFUND))).code).toBe("unknown");
  });
});
