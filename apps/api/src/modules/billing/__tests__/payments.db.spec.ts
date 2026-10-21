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
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
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

// Finance F2 (spec §4.3 S1/S2/S9/S11, §4.6, §4.8): recording a payment — the receipt number, the
// settlement it leaves, the refusals, the audit row and what the database keeps.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;
/** The invoice the first test paid in full; the refusals below read it. */
let paidInvoice = { id: "", number: "" };

type Settlement = { state: string; paidMinor: string; owedMinor: string };

type Answer = {
  payment: {
    id: string;
    receiptNumber: string;
    reference: string | null;
    businessDate: string;
    cashSeq: string | null;
  };
  settlement: Settlement;
};

type CreditAnswer = { allocations: unknown[]; settlement: Settlement; creditBalanceMinor: string };

const cash = (amountMinor: string) => ({ method: "cash", amountMinor });
const seqOf = (receiptNumber: string) => Number(receiptNumber.split("-").at(-1));
const invoiceOn = async (branchId: string, total: string) =>
  manualInvoice(h, C.admin.cookie, await patientIn(h, C, branchId), branchId, total);
const freeLine = (unitPriceMinor: string) => ({
  kind: "free",
  descriptionAr: "جلسة",
  descriptionEn: "Session",
  quantity: 1,
  unitPriceMinor,
  discount: null,
});
const editTo = (invoiceId: string, totalMinor: string, ifMatch: string) =>
  call(h, {
    method: "PATCH",
    url: `/v1/invoices/${invoiceId}`,
    host: APP,
    cookie: C.admin.cookie,
    body: { lines: [freeLine(totalMinor)], invoiceDiscount: null },
    headers: { "if-match": ifMatch },
  });
const voidInvoice = async (invoiceId: string) => {
  const shown = await send(h, C.admin.cookie, "GET", `/v1/invoices/${invoiceId}`);
  return call(h, {
    method: "POST",
    url: `/v1/invoices/${invoiceId}/void`,
    host: APP,
    cookie: C.admin.cookie,
    body: { reason: "issued twice" },
    headers: { "if-match": String(shown.headers["etag"]) },
  });
};

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
});

afterAll(() => closeHarness(h));

// The receipt numbers of the first test are absolute, so it runs before every other payment of this file.
describe("recording a payment (spec §4.3 S1 and S2)", () => {
  it("pays a part of an invoice and then the rest, with the branch receipt numbers", async () => {
    const invoice = await invoiceOn(C.branchD, "10000");
    const first = await pay(h, C.admin.cookie, invoice.id, cash("4000"));
    expect(first.statusCode, first.body).toBe(201);
    const one = first.json() as Answer;
    const year = one.payment.businessDate.slice(0, 4);
    expect(one.payment.receiptNumber).toBe(`SLMD-R-${year}-000001`);
    expect(one.payment.cashSeq).toBe("1");
    expect(one.payment.reference).toBeNull();
    expect(one.settlement).toEqual({
      state: "partly_paid",
      paidMinor: "4000",
      owedMinor: "6000",
    });
    const second = await pay(h, C.admin.cookie, invoice.id, {
      method: "knet",
      amountMinor: "6000",
      reference: "AB12",
    });
    expect(second.statusCode, second.body).toBe(201);
    const two = second.json() as Answer;
    expect(two.payment.receiptNumber).toBe(`SLMD-R-${year}-000002`);
    expect(two.payment.cashSeq).toBeNull();
    expect(two.payment.reference).toBe("AB12");
    expect(two.settlement).toEqual({ state: "paid", paidMinor: "10000", owedMinor: "0" });
    const shown = await send(h, C.admin.cookie, "GET", `/v1/invoices/${invoice.id}`);
    expect(shown.statusCode, shown.body).toBe(200);
    expect((shown.json() as { invoice: { settlement: unknown } }).invoice.settlement).toEqual({
      state: "paid",
      paidMinor: "10000",
      owedMinor: "0",
    });
    paidInvoice = invoice;
  });
});

describe("the refusals of a payment (spec §4.3 S9 and S11)", () => {
  it("refuses an amount above what the invoice owes (S9) and writes nothing", async () => {
    const invoice = await invoiceOn(C.branchD, "5000");
    const res = await pay(h, C.admin.cookie, invoice.id, cash("6000"));
    expect([res.statusCode, code(res)]).toEqual([409, "payment_exceeds_balance"]);
    const rows = await h.owner`SELECT id FROM payments
                           WHERE clinic_id = ${C.clinicId} AND invoice_id = ${invoice.id}`;
    expect(rows).toHaveLength(0);
  });

  it("refuses a payment on a zero-total invoice (S11) and on a paid one", async () => {
    const zero = await invoiceOn(C.branchD, "0");
    const onZero = await pay(h, C.admin.cookie, zero.id, cash("1"));
    expect([onZero.statusCode, code(onZero)]).toEqual([409, "invoice_settled"]);
    const onPaid = await pay(h, C.admin.cookie, paidInvoice.id, cash("1"));
    expect([onPaid.statusCode, code(onPaid)]).toEqual([409, "invoice_settled"]);
  });

  it("refuses a payment on a void invoice", async () => {
    const invoice = await invoiceOn(C.branchD, "1000");
    const voided = await voidInvoice(invoice.id);
    expect(voided.statusCode, voided.body).toBe(200);
    const res = await pay(h, C.admin.cookie, invoice.id, cash("1000"));
    expect([res.statusCode, code(res)]).toEqual([409, "invoice_void"]);
  });

  it("refuses a zero amount and a request without an idempotency key", async () => {
    const invoice = await invoiceOn(C.branchD, "1000");
    const zero = await pay(h, C.admin.cookie, invoice.id, cash("0"));
    expect([zero.statusCode, code(zero)]).toEqual([400, "validation"]);
    const noKey = await send(
      h,
      C.admin.cookie,
      "POST",
      `/v1/invoices/${invoice.id}/payments`,
      cash("1000"),
    );
    expect([noKey.statusCode, code(noKey)]).toEqual([400, "validation"]);
  });
});

describe("the receipt numbers (spec §4.6, R1-9)", () => {
  it("numbers the receipts per branch: branch R starts at one whatever branch D used", async () => {
    const invoice = await invoiceOn(C.branchR, "1000");
    const res = await pay(h, C.cashier.cookie, invoice.id, cash("1000"));
    expect(res.statusCode, res.body).toBe(201);
    const answer = res.json() as Answer;
    const year = answer.payment.businessDate.slice(0, 4);
    expect(answer.payment.receiptNumber).toBe(`SLMR-R-${year}-000001`);
  });
});

describe("the idempotency of a payment and of a credit application (spec §4.4, R3-6)", () => {
  it("replays the same key and body, and refuses the same key on another invoice", async () => {
    const invoice = await invoiceOn(C.branchD, "3000");
    const other = await invoiceOn(C.branchD, "3000");
    const key = randomUUID();
    const first = await pay(h, C.admin.cookie, invoice.id, cash("2000"), key);
    expect(first.statusCode, first.body).toBe(201);
    const one = first.json() as Answer;
    const replay = await pay(h, C.admin.cookie, invoice.id, cash("2000"), key);
    expect(replay.statusCode, replay.body).toBe(201);
    const two = replay.json() as Answer;
    expect(two.payment.id).toBe(one.payment.id);
    expect(two.payment.receiptNumber).toBe(one.payment.receiptNumber);
    const next = await pay(h, C.admin.cookie, invoice.id, cash("1"));
    expect(next.statusCode, next.body).toBe(201);
    expect(seqOf((next.json() as Answer).payment.receiptNumber)).toBe(
      seqOf(one.payment.receiptNumber) + 1,
    );
    const conflict = await pay(h, C.admin.cookie, other.id, cash("2000"), key);
    expect([conflict.statusCode, code(conflict)]).toEqual([409, "idempotency_conflict"]);
  });

  it("replays the first answer after the invoice was voided", async () => {
    const invoice = await invoiceOn(C.branchD, "3000");
    const key = randomUUID();
    const first = await pay(h, C.admin.cookie, invoice.id, cash("1000"), key);
    expect(first.statusCode, first.body).toBe(201);
    const voided = await voidInvoice(invoice.id);
    expect(voided.statusCode, voided.body).toBe(200);
    const replay = await pay(h, C.admin.cookie, invoice.id, cash("1000"), key);
    expect(replay.statusCode, replay.body).toBe(201);
    const two = replay.json() as Answer;
    expect(two.payment.id).toBe((first.json() as Answer).payment.id);
    expect(two.settlement).toEqual((first.json() as Answer).settlement);
    expect(two.settlement).toEqual({ state: "partly_paid", paidMinor: "1000", owedMinor: "2000" });
  });

  it("replays the first credit answer after the invoice was voided", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const paid = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "10000");
    const first = await pay(h, C.admin.cookie, paid.id, cash("10000"));
    expect(first.statusCode, first.body).toBe(201);
    const edited = await editTo(paid.id, "7000", '"1"');
    expect(edited.statusCode, edited.body).toBe(200);
    const target = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "5000");
    const key = randomUUID();
    const applied = await applyCredit(h, C.admin.cookie, target.id, "1000", key);
    expect(applied.statusCode, applied.body).toBe(201);
    const one = applied.json() as CreditAnswer;
    const voided = await voidInvoice(target.id);
    expect(voided.statusCode, voided.body).toBe(200);
    const replay = await applyCredit(h, C.admin.cookie, target.id, "1000", key);
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json()).toEqual(one);
  });
});

describe("the audit row of a payment (spec §4.6)", () => {
  it("writes one patient-access row with the receipt, and never the reference", async () => {
    const invoice = await invoiceOn(C.branchD, "1000");
    const since = new Date();
    const res = await pay(h, C.admin.cookie, invoice.id, {
      method: "knet",
      amountMinor: "1000",
      reference: "KNET-REF-77",
    });
    expect(res.statusCode, res.body).toBe(201);
    const answer = res.json() as Answer;
    const rows = (await auditSince(h, C.clinicId, since)).filter(
      (row) => row["action"] === "payment.recorded",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "payment.recorded",
      category: "patient_access",
      entity_type: "payment",
      entity_id: answer.payment.id,
    });
    const details = rows[0]!["details"] as { after: Record<string, unknown> };
    expect(details.after).toEqual({
      receiptNumber: answer.payment.receiptNumber,
      invoiceNumber: invoice.number,
      method: "knet",
      amountMinor: "1000",
      currency: "KWD",
      cashSeq: null,
    });
    expect(JSON.stringify(details)).not.toContain("KNET-REF-77");
  });
});

describe("what the database keeps of a payment (spec §4.2)", () => {
  it("stores the money as written, with one allocation of the whole amount", async () => {
    const invoice = await invoiceOn(C.branchD, "1000");
    const res = await pay(h, C.admin.cookie, invoice.id, cash("1000"));
    expect(res.statusCode, res.body).toBe(201);
    const answer = res.json() as Answer;
    const [row] = await h.owner`SELECT business_date::text AS business_date, year, receipt_seq,
            received_by, cash_seq::text AS cash_seq, amount_minor::text AS amount_minor
          FROM payments WHERE clinic_id = ${C.clinicId} AND id = ${answer.payment.id}`;
    expect(row).toMatchObject({
      business_date: answer.payment.businessDate,
      year: Number(answer.payment.businessDate.slice(0, 4)),
      received_by: C.admin.memberId,
      cash_seq: answer.payment.cashSeq,
      amount_minor: "1000",
    });
    expect(Number(row!["receipt_seq"])).toBe(seqOf(answer.payment.receiptNumber));
    const allocations =
      await h.owner`SELECT invoice_id, payment_id, amount_minor::text AS amount_minor
          FROM payment_allocations
          WHERE clinic_id = ${C.clinicId} AND payment_id = ${answer.payment.id}`;
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({
      invoice_id: invoice.id,
      payment_id: answer.payment.id,
      amount_minor: "1000",
    });
  });
});
