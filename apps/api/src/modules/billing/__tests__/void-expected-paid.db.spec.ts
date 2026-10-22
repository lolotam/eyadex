import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  APP,
  call,
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import {
  financeClinic,
  manualInvoice,
  pay,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

// Finance F2 (issue #113): voiding an invoice that money is paid on turns that money into the patient's
// credit, and a payment does not move the invoice's version, so the API decides atomically: the request
// carries the paid amount the user confirmed, and the API refuses the void when the invoice was paid
// more since that read.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;

type Settlement = { state: string; paidMinor: string; owedMinor: string };
type InvoiceAnswer = { invoice: { status: string; settlement: Settlement | null } };

const cash = (amountMinor: string) => ({ method: "cash", amountMinor });

/** POST /v1/invoices/:id/void with `If-Match` and the paid amount the user confirmed, when given. */
const voidIt = (invoiceId: string, ifMatch: string, expectedPaidMinor?: string) =>
  call(h, {
    method: "POST",
    url: `/v1/invoices/${invoiceId}/void`,
    host: APP,
    cookie: C.admin.cookie,
    body: { reason: "issued twice", expectedPaidMinor },
    headers: { "if-match": ifMatch },
  });

/** GET /v1/invoices/:id, so the test reads the invoice as it stands after the refused void. */
const readIt = (invoiceId: string) =>
  call(h, { method: "GET", url: `/v1/invoices/${invoiceId}`, host: APP, cookie: C.admin.cookie });

/** A payment that must succeed, so the test fails loudly when it does not. */
async function payOk(invoiceId: string, amountMinor: string) {
  const res = await pay(h, C.admin.cookie, invoiceId, cash(amountMinor));
  if (res.statusCode !== 201) throw new Error(`pay ${res.statusCode} ${res.body}`);
}

/** The patient's credits, oldest first. */
const creditsOf = (patientId: string) =>
  h.owner`SELECT c.id, c.amount_minor::text AS amount_minor, c.cause
          FROM patient_credits c
          WHERE c.clinic_id = ${C.clinicId} AND c.patient_id = ${patientId}
          ORDER BY c.created_at, c.id`;

/** A fresh patient and their invoice of `total` on branch D. */
async function invoiceOf(total: string) {
  const patient = await patientIn(h, C, C.branchD);
  const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, total);
  return { patient, invoice };
}

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
});

afterAll(() => closeHarness(h));

describe("the void of an invoice money was paid on (issue #113)", () => {
  it("voids with the paid amount the user confirmed and releases the credit", async () => {
    const { patient, invoice } = await invoiceOf("10000");
    await payOk(invoice.id, "4000");
    const res = await voidIt(invoice.id, '"1"', "4000");
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as InvoiceAnswer).invoice.status).toBe("void");
    const credits = await creditsOf(patient);
    expect(credits).toHaveLength(1);
    expect(credits[0]!).toMatchObject({ amount_minor: "4000", cause: "invoice_voided" });
  });

  it("refuses the void when a payment was recorded after the user's read", async () => {
    const { patient, invoice } = await invoiceOf("10000");
    await payOk(invoice.id, "4000");
    // The user's screen still shows 4000; this payment lands after that read.
    await payOk(invoice.id, "3000");
    const res = await voidIt(invoice.id, '"1"', "4000");
    expect([res.statusCode, code(res)]).toEqual([409, "invoice_paid_changed"]);
    // The invoice stays issued and no credit was written.
    const still = await readIt(invoice.id);
    expect(still.statusCode, still.body).toBe(200);
    expect((still.json() as InvoiceAnswer).invoice).toMatchObject({
      status: "issued",
      settlement: { state: "partly_paid", paidMinor: "7000", owedMinor: "3000" },
    });
    expect(await creditsOf(patient)).toHaveLength(0);
  });

  it("voids without the confirmed amount, as the web that is live today sends it", async () => {
    const { patient, invoice } = await invoiceOf("10000");
    await payOk(invoice.id, "4000");
    const res = await voidIt(invoice.id, '"1"');
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as InvoiceAnswer).invoice.status).toBe("void");
    expect(await creditsOf(patient)).toHaveLength(1);
  });
});
