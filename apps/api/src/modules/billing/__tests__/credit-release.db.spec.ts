import { randomUUID } from "node:crypto";

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
  applyCredit,
  auditSince,
  financeClinic,
  manualInvoice,
  pay,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

// Finance F2 (spec §4.3 S3–S6, §4.8): the credit an edit or a void releases, and the use of it.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;
/** The invoice of the first test (I1) and the credit its edit released. */
let i1 = { patient: "", invoice: "", number: "", creditId: "" };
/** The audit rows the edit of the first test and the credit use wrote. */
let released: Record<string, unknown>[] = [];
let applied: Record<string, unknown>[] = [];

type Settlement = { state: string; paidMinor: string; owedMinor: string };
type CreditAnswer = {
  allocations: { id: string; creditId: string; amountMinor: string }[];
  settlement: Settlement;
  creditBalanceMinor: string;
};
type InvoiceAnswer = { invoice: { number: string; settlement: Settlement | null } };

const cash = (amountMinor: string) => ({ method: "cash", amountMinor });
const knet = (amountMinor: string) => ({ method: "knet", amountMinor });
const PARTLY_7000 = { state: "partly_paid", paidMinor: "7000", owedMinor: "2000" };
const PARTLY_3000 = { state: "partly_paid", paidMinor: "3000", owedMinor: "2000" };

/** The only line these invoices carry: one free line of the given price. */
const freeLine = (unitPriceMinor: string) => ({
  kind: "free",
  descriptionAr: "جلسة",
  descriptionEn: "Session",
  quantity: 1,
  unitPriceMinor,
  discount: null,
});

/** PATCH /v1/invoices/:id with `If-Match`: the invoice's new total comes from its only line. */
const editTo = (invoiceId: string, totalMinor: string, ifMatch: string) =>
  call(h, {
    method: "PATCH",
    url: `/v1/invoices/${invoiceId}`,
    host: APP,
    cookie: C.admin.cookie,
    body: { lines: [freeLine(totalMinor)], invoiceDiscount: null },
    headers: { "if-match": ifMatch },
  });

/** POST /v1/invoices/:id/void with `If-Match`. */
const voidIt = (invoiceId: string, ifMatch: string) =>
  call(h, {
    method: "POST",
    url: `/v1/invoices/${invoiceId}/void`,
    host: APP,
    cookie: C.admin.cookie,
    body: { reason: "issued twice" },
    headers: { "if-match": ifMatch },
  });

/** A payment that must succeed, so the test reads its receipt. */
async function payOk(invoiceId: string, body: { method: string; amountMinor: string }) {
  const res = await pay(h, C.admin.cookie, invoiceId, body);
  if (res.statusCode !== 201) throw new Error(`pay ${res.statusCode} ${res.body}`);
  return res.json() as { payment: { id: string } };
}

/** The settlement an answer carries: the state and the two amounts behind it. */
const settlementOf = (res: { json: () => unknown }) =>
  (res.json() as InvoiceAnswer).invoice.settlement;

/** The patient's credits, oldest first, with the payment each of them came out of. */
const creditsOf = (patientId: string) =>
  h.owner`SELECT c.id, c.origin_allocation_id, c.amount_minor::text AS amount_minor, c.cause,
                  a.payment_id
          FROM patient_credits c
          JOIN payment_allocations a ON a.clinic_id = c.clinic_id AND a.id = c.origin_allocation_id
          WHERE c.clinic_id = ${C.clinicId} AND c.patient_id = ${patientId}
          ORDER BY c.created_at, c.id`;

/** A fresh patient and their invoice of `total` on branch D. */
async function invoiceOf(total: string) {
  const patient = await patientIn(h, C, C.branchD);
  const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, total);
  return { patient, invoice };
}

/**
 * A fresh patient whose invoice of `total` was paid in full and then edited down by `released`, with a
 * second invoice of `owed` to spend the credit on.
 */
async function patientWithCredit(total: string, released: string, owed: string) {
  const { patient, invoice } = await invoiceOf(total);
  await payOk(invoice.id, cash(total));
  const edited = await editTo(invoice.id, (BigInt(total) - BigInt(released)).toString(), '"1"');
  if (edited.statusCode !== 200) throw new Error(`edit ${edited.statusCode} ${edited.body}`);
  const target = await manualInvoice(h, C.admin.cookie, patient, C.branchD, owed);
  return { patient, target };
}

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
});

afterAll(() => closeHarness(h));

describe("the release of an edit and of a void (spec §4.3 S3, S4 and S6)", () => {
  it("releases the excess of a lowered invoice into one credit (S3)", async () => {
    const { patient, invoice } = await invoiceOf("10000");
    await payOk(invoice.id, cash("4000"));
    const second = await payOk(invoice.id, knet("6000"));
    const since = new Date();
    const res = await editTo(invoice.id, "7000", '"1"');
    expect(res.statusCode, res.body).toBe(200);
    expect(settlementOf(res)).toEqual({ state: "paid", paidMinor: "7000", owedMinor: "0" });
    const credits = await creditsOf(patient);
    expect(credits).toHaveLength(1);
    const credit = credits[0]!;
    expect(credit).toMatchObject({ amount_minor: "3000", cause: "invoice_edited" });
    // F2-Q18: the newest allocation first, so the 6000 receipt gives the money back.
    expect(String(credit["payment_id"])).toBe(second.payment.id);
    i1 = { patient, invoice: invoice.id, number: invoice.number, creditId: String(credit["id"]) };
    released = await auditSince(h, C.clinicId, since);
  });

  it("raises what is owed and takes no credit back (S4)", async () => {
    const res = await editTo(i1.invoice, "9000", '"2"');
    expect(res.statusCode, res.body).toBe(200);
    expect(settlementOf(res)).toEqual(PARTLY_7000);
    expect(await creditsOf(i1.patient)).toHaveLength(1);
  });

  it("takes the whole newest allocation and then the older one", async () => {
    const { patient, invoice } = await invoiceOf("10000");
    const first = await payOk(invoice.id, cash("4000"));
    const second = await payOk(invoice.id, knet("6000"));
    const res = await editTo(invoice.id, "3000", '"1"');
    expect(res.statusCode, res.body).toBe(200);
    const credits = await creditsOf(patient);
    expect(credits).toHaveLength(2);
    expect(credits[0]).toMatchObject({ amount_minor: "6000", cause: "invoice_edited" });
    expect(credits[1]).toMatchObject({ amount_minor: "1000", cause: "invoice_edited" });
    expect(String(credits[0]!["payment_id"])).toBe(second.payment.id);
    expect(String(credits[1]!["payment_id"])).toBe(first.payment.id);
  });

  it("releases the credit-funded allocation into a credit again (S6)", async () => {
    const { patient, target } = await patientWithCredit("10000", "3000", "5000");
    const spent = await applyCredit(h, C.admin.cookie, target.id, "3000");
    expect(spent.statusCode, spent.body).toBe(201);
    const allocation = (spent.json() as CreditAnswer).allocations[0]!;
    const voided = await voidIt(target.id, '"1"');
    expect(voided.statusCode, voided.body).toBe(200);
    expect(settlementOf(voided)).toBeNull();
    const credits = await creditsOf(patient);
    expect(credits).toHaveLength(2);
    expect(credits[1]).toMatchObject({ amount_minor: "3000", cause: "invoice_voided" });
    expect(String(credits[1]!["origin_allocation_id"])).toBe(allocation.id);
  });

  it("releases every live allocation of a paid invoice, newest first", async () => {
    const { patient, invoice } = await invoiceOf("10000");
    const first = await payOk(invoice.id, cash("4000"));
    const second = await payOk(invoice.id, knet("6000"));
    const voided = await voidIt(invoice.id, '"1"');
    expect(voided.statusCode, voided.body).toBe(200);
    const credits = await creditsOf(patient);
    expect(credits).toHaveLength(2);
    expect(credits[0]).toMatchObject({ amount_minor: "6000", cause: "invoice_voided" });
    expect(credits[1]).toMatchObject({ amount_minor: "4000", cause: "invoice_voided" });
    expect(String(credits[0]!["payment_id"])).toBe(second.payment.id);
    expect(String(credits[1]!["payment_id"])).toBe(first.payment.id);
  });
});

describe("the use of the patient's credit and its refusals (spec §4.3 S5, §4.6)", () => {
  it("spends the credit on another invoice of the same patient (S5)", async () => {
    const second = await manualInvoice(h, C.admin.cookie, i1.patient, C.branchD, "5000");
    const since = new Date();
    const res = await applyCredit(h, C.admin.cookie, second.id, "3000");
    expect(res.statusCode, res.body).toBe(201);
    const answer = res.json() as CreditAnswer;
    expect(answer.allocations).toHaveLength(1);
    expect(answer.allocations[0]).toMatchObject({ creditId: i1.creditId, amountMinor: "3000" });
    expect(answer.settlement).toEqual(PARTLY_3000);
    expect(answer.creditBalanceMinor).toBe("0");
    applied = await auditSince(h, C.clinicId, since);
  });

  it("spends the oldest credit first", async () => {
    const { patient, invoice } = await invoiceOf("10000");
    await payOk(invoice.id, cash("10000"));
    const first = await editTo(invoice.id, "9000", '"1"');
    const second = await editTo(invoice.id, "7000", '"2"');
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    const credits = await creditsOf(patient);
    expect(credits.map((row) => row["amount_minor"])).toEqual(["1000", "2000"]);
    const target = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "5000");
    const res = await applyCredit(h, C.admin.cookie, target.id, "1500");
    expect(res.statusCode, res.body).toBe(201);
    const answer = res.json() as CreditAnswer;
    expect(answer.allocations).toHaveLength(2);
    expect(answer.allocations).toMatchObject([
      { creditId: String(credits[0]!["id"]), amountMinor: "1000" },
      { creditId: String(credits[1]!["id"]), amountMinor: "500" },
    ]);
  });

  it("refuses an amount above the patient's credit balance", async () => {
    const { target } = await patientWithCredit("10000", "3000", "5000");
    const res = await applyCredit(h, C.admin.cookie, target.id, "4000");
    expect([res.statusCode, code(res)]).toEqual([409, "credit_insufficient"]);
  });

  it("refuses an amount above what the invoice owes", async () => {
    const { target } = await patientWithCredit("10000", "3000", "2000");
    const res = await applyCredit(h, C.admin.cookie, target.id, "4000");
    expect([res.statusCode, code(res)]).toEqual([409, "payment_exceeds_balance"]);
  });

  it("refuses a void invoice", async () => {
    const { target } = await patientWithCredit("10000", "3000", "2000");
    const voided = await voidIt(target.id, '"1"');
    expect(voided.statusCode, voided.body).toBe(200);
    const res = await applyCredit(h, C.admin.cookie, target.id, "1000");
    expect([res.statusCode, code(res)]).toEqual([409, "invoice_void"]);
  });

  it("replays the same key and the same body", async () => {
    const { target } = await patientWithCredit("10000", "3000", "5000");
    const key = randomUUID();
    const first = await applyCredit(h, C.admin.cookie, target.id, "1000", key);
    expect(first.statusCode, first.body).toBe(201);
    const replay = await applyCredit(h, C.admin.cookie, target.id, "1000", key);
    expect(replay.statusCode, replay.body).toBe(201);
    expect((replay.json() as CreditAnswer).allocations).toEqual(
      (first.json() as CreditAnswer).allocations,
    );
  });

  it("refuses the same key and the same body on another invoice", async () => {
    const { patient, target } = await patientWithCredit("10000", "3000", "5000");
    const other = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "5000");
    const key = randomUUID();
    const first = await applyCredit(h, C.admin.cookie, target.id, "1000", key);
    expect(first.statusCode, first.body).toBe(201);
    const conflict = await applyCredit(h, C.admin.cookie, other.id, "1000", key);
    expect([conflict.statusCode, code(conflict)]).toEqual([409, "idempotency_conflict"]);
  });
});

describe("the audit rows of a release and of a credit use (spec §4.6)", () => {
  it("writes the invoice row, one credit row per release, and the credit use", async () => {
    const credits = await creditsOf(i1.patient);
    const edited = released.filter((row) => row["action"] === "invoice.edited");
    expect(edited).toHaveLength(1);
    expect(edited[0]).toMatchObject({ entity_type: "invoice", entity_id: i1.invoice });
    const release = released.filter((row) => row["action"] === "credit.released");
    expect(release).toHaveLength(1);
    expect(release[0]).toMatchObject({ category: "patient_access", entity_type: "patient_credit" });
    expect(String(release[0]!["entity_id"])).toBe(String(credits[0]!["id"]));
    const details = release[0]!["details"] as { after: Record<string, unknown> };
    expect(details.after).toEqual({
      invoiceNumber: i1.number,
      amountMinor: "3000",
      currency: "KWD",
      cause: "invoice_edited",
      allocationId: String(credits[0]!["origin_allocation_id"]),
    });
    const use = applied.filter((row) => row["action"] === "credit.applied");
    expect(use).toHaveLength(1);
    const spends = (use[0]!["details"] as { after: { spends: unknown } }).after.spends;
    expect(spends).toEqual([{ creditId: String(credits[0]!["id"]), amountMinor: "3000" }]);
  });
});
