import { beforeEach, describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { BRANCH, CLINIC, TS, USER, clientWith, me, type Call } from "./fetch-stub";

// The void route over HTTP: the confirmed paid amount travels in the body (issue #113).
const P: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };
const INVOICE = "0190a000-0000-7000-8000-0000000000d1";
const PATIENT = "0190a000-0000-7000-8000-0000000000d3";
const invoice = {
  id: INVOICE,
  number: "TT-2026-000001",
  status: "issued",
  source: "manual",
  sourceId: null,
  branchId: BRANCH,
  branchNameAr: "فرع",
  branchNameEn: "Branch",
  patientId: PATIENT,
  issuedAt: TS,
  currency: "KWD",
  currencyExponent: 3,
  subtotalMinor: "4000",
  discountMinor: "0",
  taxRateBp: 0,
  taxMinor: "0",
  totalMinor: "4000",
  settlement: { state: "partly_paid", paidMinor: "1000", owedMinor: "3000" },
  invoiceDiscount: null,
  lines: [],
  voidReason: null,
  voidedAt: null,
  version: 1,
};

/** Answers the void route with a valid invoice; the me route answers the session lookup. */
function answer(call: Call) {
  const path = call.url.replace(/\?.*$/, "");
  if (path === "/api/v1/me") return { body: me };
  if (path === `/api/v1/invoices/${INVOICE}/void`) return { body: { invoice } };
  return { status: 404, body: {} };
}

let h: ReturnType<typeof clientWith>;
beforeEach(() => {
  h = clientWith(answer);
});
const last = () => h.calls.at(-1)!;

describe("the invoice void over HTTP", () => {
  it("sends the confirmed paid amount with the reason and the version", async () => {
    const voided = await h.api.finance.voidInvoice(P, INVOICE, 1, "issued twice", "1000");
    expect(voided).toEqual(invoice);
    expect(last()).toMatchObject({
      method: "POST",
      url: `/api/v1/invoices/${INVOICE}/void`,
      body: { reason: "issued twice", expectedPaidMinor: "1000" },
    });
    expect(last().headers["If-Match"]).toBe("1");
  });

  it("sends no amount when the screen confirmed none", async () => {
    await h.api.finance.voidInvoice(P, INVOICE, 1, "issued twice");
    expect(last().body).toEqual({ reason: "issued twice" });
  });
});
