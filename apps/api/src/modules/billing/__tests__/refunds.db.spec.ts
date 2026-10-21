import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import {
  applyCredit,
  auditSince,
  financeClinic,
  manualInvoice,
  pay,
  refund,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";
import { editTo as editInvoice, REASON, voidInvoice as voidWithEtag } from "./money-fixtures.ts";

// Finance F2 slice 5 (spec §4.3 S7/S8/S10, §4.6, §4.8): a refund from a payment and from the patient's
// credit — the refund number, the credit it spends, the settlement it leaves, the refusals, the audit
// rows and the idempotency of the request. Every request runs as eyadex_app through the API.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;

type Settlement = { state: string; paidMinor: string; owedMinor: string };
type Answer = {
  refund: {
    id: string;
    refundNumber: string;
    invoiceId: string;
    method: string;
    amountMinor: string;
    reason: string;
    businessDate: string;
    cashSeq: string | null;
    patientName: string;
  };
  settlement: Settlement | null;
  creditBalanceMinor: string;
};

const seqOf = (number: string) => Number(number.split("-").at(-1));
const paymentIdOf = (res: { json: () => unknown }) =>
  (res.json() as { payment: { id: string } }).payment.id;
const fromPayment = (paymentId: string, amountMinor: string, method = "cash") => ({
  source: "payment",
  paymentId,
  amountMinor,
  method,
  reason: REASON,
});
const fromCredit = (amountMinor: string, method = "bank_transfer") => ({
  source: "credit",
  amountMinor,
  method,
  reason: REASON,
});
const editTo = (invoiceId: string, totalMinor: string, ifMatch: string) =>
  editInvoice(h, C.admin.cookie, invoiceId, totalMinor, ifMatch);
const voidInvoice = (invoiceId: string) => voidWithEtag(h, C.admin.cookie, invoiceId);
const settlementOf = async (invoiceId: string) => {
  const res = await send(h, C.admin.cookie, "GET", `/v1/invoices/${invoiceId}`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { invoice: { settlement: unknown } }).invoice.settlement;
};
/** The patient's money as the database holds it: Σ payments = Σ paid + Σ credit left + Σ refunds. */
const conservation = async (patientId: string) => {
  const [row] = await h.owner`SELECT
      (SELECT coalesce(sum(amount_minor), 0) FROM payments
        WHERE clinic_id = ${C.clinicId} AND patient_id = ${patientId})::text AS received,
      (SELECT coalesce(sum(amount_minor), 0) FROM refunds
        WHERE clinic_id = ${C.clinicId} AND patient_id = ${patientId})::text AS refunded`;
  return row as { received: string; refunded: string };
};

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
});

afterAll(() => closeHarness(h));

// The refund numbers of this walk are absolute, so it runs before every other refund of this file.
describe("the worked examples S1–S8 and S10 (spec §4.3)", () => {
  it("refunds from credit on a void invoice, then from a payment, and refuses above it", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const i1 = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "10000");
    const p1 = await pay(h, C.admin.cookie, i1.id, { method: "cash", amountMinor: "4000" });
    expect(p1.statusCode, p1.body).toBe(201);
    const p2 = await pay(h, C.admin.cookie, i1.id, { method: "knet", amountMinor: "6000" });
    expect(p2.statusCode, p2.body).toBe(201);
    expect((await editTo(i1.id, "7000", '"1"')).statusCode).toBe(200);
    expect((await editTo(i1.id, "9000", '"2"')).statusCode).toBe(200);
    const i2 = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "5000");
    expect((await applyCredit(h, C.admin.cookie, i2.id, "3000")).statusCode).toBe(201);
    expect((await voidInvoice(i2.id)).statusCode).toBe(200);

    // S7: the void released 3000 into credit; a credit refund works on the void invoice.
    const s7 = await refund(h, C.admin.cookie, i2.id, fromCredit("3000"));
    expect(s7.statusCode, s7.body).toBe(201);
    const seven = s7.json() as Answer;
    const year = seven.refund.businessDate.slice(0, 4);
    expect(seven.refund.refundNumber).toBe(`SLMD-RF-${year}-000001`);
    expect(seven.refund).toMatchObject({ method: "bank_transfer", cashSeq: null, reason: REASON });
    expect(seven.settlement).toBeNull();
    expect(seven.creditBalanceMinor).toBe("0");

    // S8: 1000 back from P1 in cash: P1's allocation releases into a credit the refund spends.
    const s8 = await refund(h, C.admin.cookie, i1.id, fromPayment(paymentIdOf(p1), "1000"));
    expect(s8.statusCode, s8.body).toBe(201);
    const eight = s8.json() as Answer;
    expect(eight.refund.refundNumber).toBe(`SLMD-RF-${year}-000002`);
    expect(eight.refund.cashSeq).not.toBeNull();
    expect(eight.settlement).toEqual({
      state: "partly_paid",
      paidMinor: "6000",
      owedMinor: "3000",
    });
    expect(eight.creditBalanceMinor).toBe("0");
    const released =
      await h.owner`SELECT c.amount_minor::text AS amount_minor, c.cause, a.payment_id
                                   FROM patient_credits c
                                   JOIN payment_allocations a ON a.clinic_id = c.clinic_id
                                     AND a.id = c.origin_allocation_id
                                   WHERE c.clinic_id = ${C.clinicId} AND c.cause = 'refund'
                                     AND c.patient_id = ${patient}`;
    expect(released).toEqual([
      { amount_minor: "1000", cause: "refund", payment_id: paymentIdOf(p1) },
    ]);

    // S10: P1's live allocation on I1 is 3000 now, so 4000 is refused and nothing is written.
    const s10 = await refund(h, C.admin.cookie, i1.id, fromPayment(paymentIdOf(p1), "4000"));
    expect([s10.statusCode, code(s10)]).toEqual([409, "refund_exceeds_available"]);
    expect(await settlementOf(i1.id)).toEqual({
      state: "partly_paid",
      paidMinor: "6000",
      owedMinor: "3000",
    });
    // Conservation after S8: payments 10000 = paid 6000 + credit 0 + refunds 4000.
    expect(await conservation(patient)).toEqual({ received: "10000", refunded: "4000" });
  });
});

describe("the refusals of a refund (spec §4.6)", () => {
  it("refuses a credit refund above the patient's credit", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "1000");
    const res = await refund(h, C.admin.cookie, invoice.id, fromCredit("1"));
    expect([res.statusCode, code(res)]).toEqual([409, "credit_insufficient"]);
  });

  it("refuses a payment refund on a void invoice: the void released it all", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "1000");
    const paid = await pay(h, C.admin.cookie, invoice.id, { method: "knet", amountMinor: "1000" });
    expect((await voidInvoice(invoice.id)).statusCode).toBe(200);
    const res = await refund(h, C.admin.cookie, invoice.id, fromPayment(paymentIdOf(paid), "1"));
    expect([res.statusCode, code(res)]).toEqual([409, "refund_exceeds_available"]);
    // The released credit is still refundable, from the same invoice page.
    const fromCreditRes = await refund(h, C.admin.cookie, invoice.id, fromCredit("1000"));
    expect(fromCreditRes.statusCode, fromCreditRes.body).toBe(201);
  });

  it("answers not_found for a payment of another invoice and writes nothing", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const one = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "1000");
    const two = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "1000");
    const paid = await pay(h, C.admin.cookie, one.id, { method: "knet", amountMinor: "1000" });
    const res = await refund(h, C.admin.cookie, two.id, fromPayment(paymentIdOf(paid), "500"));
    expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
    const rows = await h.owner`SELECT id FROM refunds
                               WHERE clinic_id = ${C.clinicId} AND patient_id = ${patient}`;
    expect(rows).toHaveLength(0);
  });

  it("refuses a disabled method, a missing reason and a missing idempotency key", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "1000");
    const paid = await pay(h, C.admin.cookie, invoice.id, { method: "knet", amountMinor: "1000" });
    const body = fromPayment(paymentIdOf(paid), "500", "other");
    const off = await send(h, C.admin.cookie, "PUT", "/v1/clinic/settings/payment-methods", {
      paymentMethods: [
        { method: "cash", enabled: true },
        { method: "knet", enabled: true },
        { method: "bank_transfer", enabled: true },
        { method: "other", enabled: false },
      ],
    });
    expect(off.statusCode, off.body).toBe(200);
    try {
      const disabled = await refund(h, C.admin.cookie, invoice.id, body);
      expect([disabled.statusCode, code(disabled)]).toEqual([409, "payment_method_disabled"]);
    } finally {
      await send(h, C.admin.cookie, "PUT", "/v1/clinic/settings/payment-methods", {
        paymentMethods: ["cash", "knet", "bank_transfer", "other"].map((method) => ({
          method,
          enabled: true,
        })),
      });
    }
    const noReason = await refund(h, C.admin.cookie, invoice.id, { ...body, reason: "" });
    expect([noReason.statusCode, code(noReason)]).toEqual([400, "validation"]);
    const noKey = await send(h, C.admin.cookie, "POST", `/v1/invoices/${invoice.id}/refunds`, body);
    expect([noKey.statusCode, code(noKey)]).toEqual([400, "validation"]);
  });
});

describe("the idempotency of a refund (spec §4.4, R3-6)", () => {
  it("replays the same key and body without a number, and refuses it on another invoice", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "3000");
    const other = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "3000");
    const paid = await pay(h, C.admin.cookie, invoice.id, { method: "knet", amountMinor: "3000" });
    const body = fromPayment(paymentIdOf(paid), "1000", "knet");
    const key = randomUUID();
    const first = await refund(h, C.admin.cookie, invoice.id, body, key);
    expect(first.statusCode, first.body).toBe(201);
    const replay = await refund(h, C.admin.cookie, invoice.id, body, key);
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json()).toEqual(first.json());
    const next = await refund(h, C.admin.cookie, invoice.id, body);
    expect(next.statusCode, next.body).toBe(201);
    expect(seqOf((next.json() as Answer).refund.refundNumber)).toBe(
      seqOf((first.json() as Answer).refund.refundNumber) + 1,
    );
    const conflict = await refund(h, C.admin.cookie, other.id, body, key);
    expect([conflict.statusCode, code(conflict)]).toEqual([409, "idempotency_conflict"]);
  });
});

describe("the audit rows of a refund (spec §4.6)", () => {
  it("writes the release and the refund as patient access, with the reason's length only", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "2000");
    const paid = await pay(h, C.admin.cookie, invoice.id, { method: "knet", amountMinor: "2000" });
    const since = new Date();
    const res = await refund(h, C.admin.cookie, invoice.id, fromPayment(paymentIdOf(paid), "1500"));
    expect(res.statusCode, res.body).toBe(201);
    const answer = res.json() as Answer;
    const rows = await auditSince(h, C.clinicId, since);
    const released = rows.filter((row) => row["action"] === "credit.released");
    const recorded = rows.filter((row) => row["action"] === "refund.recorded");
    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({
      category: "patient_access",
      entity_type: "patient_credit",
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      category: "patient_access",
      entity_type: "refund",
      entity_id: answer.refund.id,
    });
    const details = recorded[0]!["details"] as {
      after: Record<string, unknown>;
      reasonLength: number;
    };
    expect(details.after).toMatchObject({
      refundNumber: answer.refund.refundNumber,
      invoiceNumber: invoice.number,
      method: "cash",
      amountMinor: "1500",
      currency: "KWD",
      cashSeq: answer.refund.cashSeq,
      source: "payment",
    });
    expect(details.after["spends"]).toEqual([
      { creditId: released[0]!["entity_id"], amountMinor: "1500" },
    ]);
    expect(details.reasonLength).toBe(REASON.length);
    expect(JSON.stringify(rows)).not.toContain(REASON);
    expect(JSON.stringify(rows)).not.toContain(answer.refund.patientName);
  });
});
