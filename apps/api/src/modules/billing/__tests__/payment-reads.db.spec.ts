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
import {
  applyCredit,
  financeClinic,
  manualInvoice,
  namedPatient,
  pay,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

// Finance F2 (spec §4.6): the reads of the money — the movements of one invoice, the list of the
// receipts with its filters, the receipt alone, and the settlement filter of the invoice list.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;
/** A receipt of branch D: the one the receptionist of branch R must not see. */
let branchDPayment = "";

type Settlement = { state: string; paidMinor: string; owedMinor: string };
type Payment = {
  id: string;
  receiptNumber: string;
  branchId: string;
  invoiceId: string;
  patientName: string;
  method: string;
  amountMinor: string;
  businessDate: string;
};
type PaymentAnswer = { payment: Payment; settlement: Settlement };
type PaymentPage = { items: Payment[]; nextCursor: string | null; total: number };
type Movement = {
  kind: string;
  amountMinor: string;
  receiptNumber?: string;
  method?: string;
  refundableMinor?: string;
  creditId?: string;
  cause?: string;
};
type MovementsAnswer = {
  settlement: Settlement | null;
  creditBalanceMinor: string;
  movements: Movement[];
};
type InvoicePage = { items: { id: string; settlement: Settlement | null }[] };

const cash = (amountMinor: string) => ({ method: "cash", amountMinor });
const knet = (amountMinor: string) => ({ method: "knet", amountMinor });
const PAID_5000 = { state: "paid", paidMinor: "5000", owedMinor: "0" };

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
  return res.json() as PaymentAnswer;
}

/** A fresh patient with a name and their invoice of `total` on branch D. */
async function invoiceOf(total: string, name: string) {
  const patient = await namedPatient(h, C, C.branchD, name);
  const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, total);
  return { patient, invoice };
}

/** The receipts list, as the caller sees it. */
const list = (cookie: string, query = "") => send(h, cookie, "GET", `/v1/payments${query}`);
/** The ids the receipts list answers with. */
const idsOf = async (query: string) =>
  ((await list(C.admin.cookie, query)).json() as PaymentPage).items.map((item) => item.id);
/** The invoices list, as the admin sees it. */
const invoices = (query: string) => send(h, C.admin.cookie, "GET", `/v1/invoices${query}`);
/** The ids the invoices list answers with. */
const invoiceIds = async (query: string) =>
  ((await invoices(query)).json() as InvoicePage).items.map((item) => item.id);

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
});

afterAll(() => closeHarness(h));

describe("the movements of one invoice (spec §4.6)", () => {
  it("lists the receipts and the release oldest first, with what may still be refunded", async () => {
    const { invoice } = await invoiceOf("10000", "مراجع حركات تجريبي");
    const first = await payOk(invoice.id, cash("4000"));
    const second = await payOk(invoice.id, knet("6000"));
    const edited = await editTo(invoice.id, "7000", '"1"');
    expect(edited.statusCode, edited.body).toBe(200);
    const res = await send(h, C.admin.cookie, "GET", `/v1/invoices/${invoice.id}/payments`);
    expect(res.statusCode, res.body).toBe(200);
    const answer = res.json() as MovementsAnswer;
    expect(answer.movements).toHaveLength(3);
    expect(answer.movements[0]).toMatchObject({
      kind: "payment",
      receiptNumber: first.payment.receiptNumber,
      method: "cash",
      amountMinor: "4000",
      refundableMinor: "4000",
    });
    expect(answer.movements[1]).toMatchObject({
      kind: "payment",
      receiptNumber: second.payment.receiptNumber,
      method: "knet",
      amountMinor: "6000",
      refundableMinor: "3000",
    });
    expect(answer.movements[2]).toMatchObject({
      kind: "credit_released",
      amountMinor: "3000",
      cause: "invoice_edited",
    });
    expect(answer.settlement).toEqual({ state: "paid", paidMinor: "7000", owedMinor: "0" });
    expect(answer.creditBalanceMinor).toBe("3000");
  });

  it("lists the credit that paid an invoice", async () => {
    const patient = await namedPatient(h, C, C.branchD, "مراجع رصيد تجريبي");
    const first = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "10000");
    await payOk(first.id, cash("10000"));
    const edited = await editTo(first.id, "7000", '"1"');
    expect(edited.statusCode, edited.body).toBe(200);
    const second = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "5000");
    const spent = await applyCredit(h, C.admin.cookie, second.id, "3000");
    expect(spent.statusCode, spent.body).toBe(201);
    const spentAnswer = spent.json() as { allocations: { creditId: string }[] };
    const creditId = spentAnswer.allocations[0]!.creditId;
    const res = await send(h, C.admin.cookie, "GET", `/v1/invoices/${second.id}/payments`);
    expect(res.statusCode, res.body).toBe(200);
    const answer = res.json() as MovementsAnswer;
    expect(answer.movements).toHaveLength(1);
    expect(answer.movements[0]).toMatchObject({
      kind: "credit_applied",
      creditId,
      amountMinor: "3000",
    });
  });
});

describe("the list of the receipts (spec §4.6)", () => {
  it("lists the receipts newest first with the patient's name", async () => {
    const patient = await namedPatient(h, C, C.branchD, "مراجع قائمة تجريبي");
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "10000");
    const first = await payOk(invoice.id, cash("4000"));
    const second = await payOk(invoice.id, knet("6000"));
    branchDPayment = first.payment.id;
    const res = await list(C.admin.cookie, `?patientId=${patient}`);
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json() as PaymentPage;
    expect(page.items.map((item) => item.id)).toEqual([second.payment.id, first.payment.id]);
    expect(page.items[0]).toMatchObject({
      patientName: "مراجع قائمة تجريبي",
      method: "knet",
      amountMinor: "6000",
    });
  });

  it("filters the receipts by method, invoice, patient, branch, number and day", async () => {
    const patient = await namedPatient(h, C, C.branchD, "مراجع فلاتر تجريبي");
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "10000");
    const first = await payOk(invoice.id, cash("4000"));
    const second = await payOk(invoice.id, knet("6000"));
    const other = await namedPatient(h, C, C.branchR, "مراجع فرع آخر");
    const otherInvoice = await manualInvoice(h, C.admin.cookie, other, C.branchR, "1000");
    const otherPay = await payOk(otherInvoice.id, cash("1000"));
    expect(await idsOf(`?patientId=${patient}&method=cash`)).toEqual([first.payment.id]);
    const byInvoice = await idsOf(`?invoiceId=${invoice.id}`);
    expect(byInvoice).toEqual([second.payment.id, first.payment.id]);
    const byBranch = await idsOf(`?branchId=${C.branchR}`);
    expect(byBranch).toEqual([otherPay.payment.id]);
    const part = first.payment.receiptNumber.slice(-6);
    const byNumber = await idsOf(`?patientId=${patient}&receiptNumber=${part}`);
    expect(byNumber).toEqual([first.payment.id]);
    const day = first.payment.businessDate;
    const byDay = await idsOf(`?patientId=${patient}&from=${day}&to=${day}`);
    expect(byDay).toHaveLength(2);
  });

  it("pages with a cursor and refuses a cursor it never made", async () => {
    const patient = await namedPatient(h, C, C.branchD, "مراجع صفحة تجريبي");
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "10000");
    const first = await payOk(invoice.id, cash("4000"));
    const second = await payOk(invoice.id, knet("6000"));
    const page1 = await list(C.admin.cookie, `?patientId=${patient}&limit=1`);
    expect(page1.statusCode, page1.body).toBe(200);
    const one = page1.json() as PaymentPage;
    expect(one.items).toHaveLength(1);
    expect(one.items[0]!.id).toBe(second.payment.id);
    expect(one.nextCursor).toBeTypeOf("string");
    const page2Query = `?patientId=${patient}&limit=1&cursor=${one.nextCursor}`;
    const page2 = await list(C.admin.cookie, page2Query);
    const two = page2.json() as PaymentPage;
    expect(two.items.map((item) => item.id)).toEqual([first.payment.id]);
    const bad = await list(C.admin.cookie, `?patientId=${patient}&cursor=not-a-cursor`);
    expect([bad.statusCode, code(bad)]).toEqual([400, "validation"]);
  });
});

describe("the receipt alone and the branch reach (spec §4.6)", () => {
  it("answers the receipt alone with the fields of the write", async () => {
    const patient = await namedPatient(h, C, C.branchD, "مراجع إيصال تجريبي");
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "1000");
    const written = await payOk(invoice.id, cash("1000"));
    const res = await send(h, C.admin.cookie, "GET", `/v1/payments/${written.payment.id}`);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { payment: Payment }).payment).toEqual(written.payment);
  });

  it("shows the receptionist of branch R only the receipts of branch R", async () => {
    const patient = await namedPatient(h, C, C.branchR, "مراجع صندوق تجريبي");
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchR, "1000");
    const recorded = await pay(h, C.receptionist.cookie, invoice.id, cash("1000"));
    expect(recorded.statusCode, recorded.body).toBe(201);
    const res = await list(C.receptionist.cookie, "?limit=100");
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json() as PaymentPage;
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((item) => item.branchId === C.branchR)).toBe(true);
    expect(page.items.map((item) => item.id)).not.toContain(branchDPayment);
  });
});

describe("the settlement filter of the invoice list (spec §4.6)", () => {
  it("returns exactly the issued invoices of the asked state", async () => {
    const patient = await namedPatient(h, C, C.branchD, "مراجع فلترة الحالة");
    const unpaid = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "5000");
    const partly = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "5000");
    await payOk(partly.id, cash("2000"));
    const paid = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "5000");
    await payOk(paid.id, cash("5000"));
    const voided = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "5000");
    const voidedRes = await voidIt(voided.id, '"1"');
    expect(voidedRes.statusCode, voidedRes.body).toBe(200);
    const unpaidIds = await invoiceIds(`?patientId=${patient}&settlement=unpaid`);
    expect(unpaidIds).toEqual([unpaid.id]);
    const partlyIds = await invoiceIds(`?patientId=${patient}&settlement=partly_paid`);
    expect(partlyIds).toEqual([partly.id]);
    const paidIds = await invoiceIds(`?patientId=${patient}&settlement=paid`);
    expect(paidIds).toEqual([paid.id]);
    const all = (await invoices(`?patientId=${patient}&limit=100`)).json() as InvoicePage;
    expect(all.items.find((item) => item.id === voided.id)?.settlement).toBeNull();
    expect(all.items.find((item) => item.id === paid.id)?.settlement).toEqual(PAID_5000);
  });
});
