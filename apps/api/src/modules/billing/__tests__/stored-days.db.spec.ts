import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  APP,
  call,
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { memberOn, roleIdOf } from "../../identity/__tests__/user-fixtures.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import { clinicBusinessDay } from "../domain/payment-rules.ts";
import {
  applyCredit,
  financeClinic,
  manualInvoice,
  pay,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

// Finance F3 slice 2b (docs/specs/finance-f3-reports-design.md §8 step 2): the writers store the clinic
// business day and who set each discount.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;
/** The patient of the issue test. */
let patient: string;
/** The second admin: the member who edits the invoice and holds the discount key (EY-10.2). */
let editor: { memberId: string; cookie: string };

/** The invoice as the API answers it: its id and the instant of its issue. */
type Issued = { invoice: { id: string; issuedAt: string } };

/** The credit application's answer: the allocations it wrote. */
type CreditAnswer = { allocations: { id: string }[] };

const free = (unitPriceMinor: string, discount: unknown = null) => ({
  kind: "free",
  descriptionAr: "جلسة",
  descriptionEn: "Session",
  quantity: 1,
  unitPriceMinor,
  discount,
});
const pct = (bp: number, reason = "courtesy") => ({ kind: "pct", bp, reason });
const amount = (minor: string) => ({ kind: "amount", minor, reason: "courtesy" });

/** The manual invoice body of the issue test: the file's patient on branch D. */
const manual = (lines: unknown[], invoiceDiscount: unknown = null) => ({
  source: "manual",
  sourceId: null,
  patientId: patient,
  branchId: C.branchD,
  lines,
  invoiceDiscount,
});
const issue = (cookie: string, body: unknown, key = randomUUID()) =>
  send(h, cookie, "POST", "/v1/invoices", body, key);

/** A manual invoice of a fresh patient of `branchId`, with the invoice discount given. */
async function issued(branchId: string, lines: unknown[], invoiceDiscount: unknown = null) {
  const patientId = await patientIn(h, C, branchId);
  const body = {
    source: "manual",
    sourceId: null,
    patientId,
    branchId,
    lines,
    invoiceDiscount,
  };
  const res = await send(h, C.admin.cookie, "POST", "/v1/invoices", body, randomUUID());
  if (res.statusCode !== 201) throw new Error(`issue ${res.statusCode} ${res.body}`);
  return (res.json() as Issued).invoice;
}

/** PATCH /v1/invoices/:id with `If-Match`. */
const edit = (
  cookie: string,
  id: string,
  lines: unknown[],
  ifMatch: string,
  invoiceDiscount: unknown = null,
) =>
  call(h, {
    method: "PATCH",
    url: `/v1/invoices/${id}`,
    host: APP,
    cookie,
    body: { lines, invoiceDiscount },
    headers: { "if-match": ifMatch },
  });

/** The invoice's discount author and the live lines' authors, in position order. */
const authorsOf = async (invoiceId: string) => {
  const [invoice] =
    await h.owner`SELECT discounted_by FROM invoices WHERE clinic_id = ${C.clinicId} AND id = ${invoiceId}`;
  const lines =
    await h.owner`SELECT discounted_by FROM invoice_lines WHERE clinic_id = ${C.clinicId} AND invoice_id = ${invoiceId} AND archived_at IS NULL ORDER BY position`;
  return [invoice!["discounted_by"], ...lines.map((line) => line["discounted_by"])];
};

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
  patient = await patientIn(h, C, C.branchD);
  editor = await memberOn(h, C.admin, await roleIdOf(h, C.clinicId, "clinic_admin"));
  await invalidate.clinicChanged(C.clinicId);
});

afterAll(() => closeHarness(h));

describe("the stored clinic day and the discount authors (F3 slice 2b)", () => {
  it("stores the clinic day and who set each discount (F3-Q1 a, EY-10.2)", async () => {
    const lines = [free("1000", pct(1000)), free("200")];
    const res = await issue(C.admin.cookie, manual(lines, amount("1")));
    expect(res.statusCode).toBe(201);
    const { invoice } = res.json() as Issued;
    const day = clinicBusinessDay(new Date(invoice.issuedAt), "Asia/Kuwait").businessDate;
    const [row] = await h.owner`SELECT business_date::text AS business_date, discounted_by
          FROM invoices WHERE clinic_id = ${C.clinicId} AND id = ${invoice.id}`;
    expect(row).toMatchObject({ business_date: day, discounted_by: C.admin.memberId });
    const stored = await h.owner`SELECT discounted_by FROM invoice_lines
          WHERE clinic_id = ${C.clinicId} AND invoice_id = ${invoice.id} AND archived_at IS NULL ORDER BY position`;
    expect(stored.map((line) => line["discounted_by"])).toEqual([C.admin.memberId, null]);
    const plain = await issue(C.admin.cookie, manual([free("300")]));
    const [none] =
      await h.owner`SELECT discounted_by FROM invoices WHERE clinic_id = ${C.clinicId} AND id = ${(plain.json() as Issued).invoice.id}`;
    expect(none).toMatchObject({ discounted_by: null });
  });

  it("keeps the author of an unchanged discount and gives a changed one to the editor", async () => {
    const invoice = await issued(C.branchR, [free("1000", pct(1000))], pct(500));
    const kept = await edit(editor.cookie, invoice.id, [free("1000", pct(1000))], '"1"', pct(500));
    expect(kept.statusCode).toBe(200);
    expect(await authorsOf(invoice.id)).toEqual([C.admin.memberId, C.admin.memberId]);
    const changed = await edit(
      editor.cookie,
      invoice.id,
      [free("1000", pct(2000))],
      '"2"',
      pct(500),
    );
    expect(changed.statusCode).toBe(200);
    expect(await authorsOf(invoice.id)).toEqual([C.admin.memberId, editor.memberId]);
    const dropped = await edit(editor.cookie, invoice.id, [free("1000", pct(2000))], '"3"', null);
    expect(dropped.statusCode).toBe(200);
    expect(await authorsOf(invoice.id)).toEqual([null, editor.memberId]);
  });

  it("stores the clinic day of a credit application (F3-Q1 a, EY-10.5)", async () => {
    const patientId = await patientIn(h, C, C.branchD);
    const first = await manualInvoice(h, C.admin.cookie, patientId, C.branchD, "10000");
    const paid = await pay(h, C.admin.cookie, first.id, { method: "cash", amountMinor: "10000" });
    expect(paid.statusCode).toBe(201);
    const lowered = await edit(C.admin.cookie, first.id, [free("7000")], '"1"');
    expect(lowered.statusCode).toBe(200);
    const second = await manualInvoice(h, C.admin.cookie, patientId, C.branchD, "5000");
    const applied = await applyCredit(h, C.admin.cookie, second.id, "3000");
    expect(applied.statusCode).toBe(201);
    const answer = applied.json() as CreditAnswer;
    const [allocation] =
      await h.owner`SELECT business_date = (created_at AT TIME ZONE 'Asia/Kuwait')::date AS same
          FROM payment_allocations WHERE clinic_id = ${C.clinicId} AND id = ${answer.allocations[0]!.id}`;
    expect(allocation).toMatchObject({ same: true });
  });
});
