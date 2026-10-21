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
  refund,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";
import { holdRows, raceOn } from "./race-fixtures.ts";

// Finance F2 slice 5 (spec §4.4, §4.8, issue #91): a patient's refunds are serialised on the patient row,
// so two refunds of one payment can never give back more than the payment, two credit refunds never
// spend more than the credit, and the refund and cash numbers of a branch stay gap-free. Every race is
// real: an owner session holds the patient's row and the API's own requests wait on it.
let h: Harness;
let C: FinanceClinic;

type Answer = { refund: { refundNumber: string; cashSeq: string | null } };

const REASON = "returned a service";
const seqOf = (number: string) => Number(number.split("-").at(-1));
const paymentIdOf = (res: { json: () => unknown }) =>
  (res.json() as { payment: { id: string } }).payment.id;

/** The patients' rows held `FOR NO KEY UPDATE`, where the API's patient lock (spec §4.4) waits. */
const holdPatients = (patientIds: readonly string[]) =>
  holdRows(h, async (sql) => {
    for (const id of patientIds) {
      await sql`SELECT id FROM patients
                WHERE clinic_id = ${C.clinicId} AND id = ${id} FOR NO KEY UPDATE`;
    }
  });

/** A paid invoice: the patient, the invoice and the payment's id. */
async function paidInvoice(branchId: string, totalMinor: string, method = "knet") {
  const patient = await patientIn(h, C, branchId);
  const invoice = await manualInvoice(h, C.admin.cookie, patient, branchId, totalMinor);
  const paid = await pay(h, C.admin.cookie, invoice.id, { method, amountMinor: totalMinor });
  expect(paid.statusCode, paid.body).toBe(201);
  return { patient, invoice, paymentId: paymentIdOf(paid) };
}

/** POST /v1/invoices/:id/void with the invoice's current ETag. */
async function voidInvoice(invoiceId: string) {
  const shown = await call(h, {
    method: "GET",
    url: `/v1/invoices/${invoiceId}`,
    host: APP,
    cookie: C.admin.cookie,
  });
  return call(h, {
    method: "POST",
    url: `/v1/invoices/${invoiceId}/void`,
    host: APP,
    cookie: C.admin.cookie,
    body: { reason: "issued twice" },
    headers: { "if-match": String(shown.headers["etag"]) },
  });
}

beforeAll(async () => {
  h = await openHarness({}, true);
  const invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
});

afterAll(() => closeHarness(h));

describe("two refunds of one payment at once (issue #91, spec §4.8)", () => {
  it("lets one of them through and refuses the one that would give back more than was paid", async () => {
    const { patient, invoice, paymentId } = await paidInvoice(C.branchD, "1000");
    const body = {
      source: "payment",
      paymentId,
      amountMinor: "600",
      method: "knet",
      reason: REASON,
    };
    const holding = await holdPatients([patient]);
    const answers = await raceOn(h, holding, 2, [
      () => refund(h, C.admin.cookie, invoice.id, body),
      () => refund(h, C.admin.cookie, invoice.id, body),
    ]);
    expect(answers.map((res) => res.statusCode).sort((a, b) => a - b)).toEqual([201, 409]);
    // The loser reads the payment after the winner committed: 400 is left, so 600 is above it.
    expect(code(answers.find((res) => res.statusCode === 409)!)).toBe("refund_exceeds_available");
    const [given] = await h.owner`SELECT coalesce(sum(c.amount_minor), 0)::text AS released
                                  FROM patient_credits c
                                  JOIN payment_allocations a ON a.clinic_id = c.clinic_id
                                    AND a.id = c.origin_allocation_id
                                  WHERE c.clinic_id = ${C.clinicId} AND a.payment_id = ${paymentId}`;
    expect(given).toEqual({ released: "600" });
  });
});

describe("two credit refunds racing the last credit (spec §4.4)", () => {
  it("spends the credit once and refuses the second refund", async () => {
    const { patient, invoice } = await paidInvoice(C.branchD, "1000");
    expect((await voidInvoice(invoice.id)).statusCode).toBe(200);
    const body = { source: "credit", amountMinor: "1000", method: "knet", reason: REASON };
    const holding = await holdPatients([patient]);
    const answers = await raceOn(h, holding, 2, [
      () => refund(h, C.admin.cookie, invoice.id, body),
      () => refund(h, C.admin.cookie, invoice.id, body),
    ]);
    expect(answers.map((res) => res.statusCode).sort((a, b) => a - b)).toEqual([201, 409]);
    expect(code(answers.find((res) => res.statusCode === 409)!)).toBe("credit_insufficient");
  });
});

describe("the refund and cash numbers of two concurrent refunds (spec §4.8, F2-Q13)", () => {
  it("gives them consecutive refund numbers and consecutive cash numbers in one branch", async () => {
    const one = await paidInvoice(C.branchR, "1000", "cash");
    const two = await paidInvoice(C.branchR, "2000", "cash");
    const holding = await holdPatients([one.patient, two.patient]);
    const answers = await raceOn(h, holding, 2, [
      () =>
        refund(h, C.admin.cookie, one.invoice.id, {
          source: "payment",
          paymentId: one.paymentId,
          amountMinor: "1000",
          method: "cash",
          reason: REASON,
        }),
      () =>
        refund(h, C.admin.cookie, two.invoice.id, {
          source: "payment",
          paymentId: two.paymentId,
          amountMinor: "2000",
          method: "cash",
          reason: REASON,
        }),
    ]);
    expect(answers.map((res) => res.statusCode)).toEqual([201, 201]);
    const refunds = answers.map((res) => (res.json() as Answer).refund);
    const numbers = refunds.map((row) => seqOf(row.refundNumber)).sort((a, b) => a - b);
    expect(numbers[1]! - numbers[0]!).toBe(1);
    const cash = refunds.map((row) => Number(row.cashSeq)).sort((a, b) => a - b);
    expect(cash[1]! - cash[0]!).toBe(1);
  });
});
