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
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import {
  auditSince,
  financeClinic,
  serviceAppointment,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

// Plan Tasks 8e and 8f (FIN-A5, FIN-8, R1-14, spec §8 rules 8 and 10): edits and voids under the
// patient → invoice lock, checked against If-Match after the lock.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;
/** The second admin: the member who edits the invoice and holds the discount key (EY-10.2). */
let editor: { memberId: string; cookie: string };

type Answer = {
  invoice: { id: string; number: string; status: string; version: number; totalMinor: string };
};

const free = (unitPriceMinor: string, discount: unknown = null) => ({
  kind: "free",
  descriptionAr: "جلسة",
  descriptionEn: "Session",
  quantity: 1,
  unitPriceMinor,
  discount,
});
const pct = (bp: number, reason = "courtesy") => ({ kind: "pct", bp, reason });

async function issued(
  branchId: string,
  lines: unknown[],
  sourceId: string | null = null,
  invoiceDiscount: unknown = null,
) {
  const patient = await patientIn(h, C, branchId);
  const body =
    sourceId === null
      ? { source: "manual", sourceId, patientId: patient, branchId, lines, invoiceDiscount }
      : {
          source: "appointment",
          sourceId,
          patientId: null,
          branchId: null,
          lines,
          invoiceDiscount,
        };
  const res = await send(h, C.admin.cookie, "POST", "/v1/invoices", body, randomUUID());
  if (res.statusCode !== 201) throw new Error(`issue ${res.statusCode} ${res.body}`);
  return (res.json() as Answer).invoice;
}

const write = (
  cookie: string,
  method: "PATCH" | "POST",
  url: string,
  body: unknown,
  ifMatch?: string,
) =>
  call(h, {
    method,
    url,
    host: APP,
    cookie,
    body,
    ...(ifMatch === undefined ? {} : { headers: { "if-match": ifMatch } }),
  });
const edit = (
  cookie: string,
  id: string,
  lines: unknown[],
  ifMatch?: string,
  invoiceDiscount: unknown = null,
) => write(cookie, "PATCH", `/v1/invoices/${id}`, { lines, invoiceDiscount }, ifMatch);
const voidIt = (cookie: string, id: string, ifMatch?: string) =>
  write(cookie, "POST", `/v1/invoices/${id}/void`, { reason: "issued twice" }, ifMatch);

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
  editor = await memberOn(h, C.admin, await roleIdOf(h, C.clinicId, "clinic_admin"));
  await invalidate.clinicChanged(C.clinicId);
});

afterAll(() => closeHarness(h));

describe("edit (FIN-A5)", () => {
  it("keeps an unchanged archived service after its price is cleared but refuses changing it", async () => {
    await send(h, C.admin.cookie, "PATCH", `/v1/services/${C.serviceId}/price`, {
      priceMinor: "1000",
    });
    const service = {
      kind: "service",
      serviceId: C.serviceId,
      providerId: null,
      quantity: 1,
      unitPriceMinor: "1000",
      discount: null,
    };
    const invoice = await issued(C.branchD, [service, free("200")]);
    await send(h, C.admin.cookie, "PATCH", `/v1/services/${C.serviceId}/price`, {
      priceMinor: null,
    });
    await h.owner`UPDATE clinic_services SET status = 'inactive' WHERE clinic_id = ${C.clinicId} AND id = ${C.serviceId}`;
    try {
      const changedOther = await edit(C.admin.cookie, invoice.id, [service, free("300")], '"1"');
      expect(changedOther.statusCode, changedOther.body).toBe(200);
      const changedService = await edit(
        C.admin.cookie,
        invoice.id,
        [{ ...service, quantity: 2 }, free("300")],
        '"2"',
      );
      expect([changedService.statusCode, code(changedService)]).toEqual([422, "price_missing"]);
    } finally {
      await h.owner`UPDATE clinic_services SET status = 'active' WHERE clinic_id = ${C.clinicId} AND id = ${C.serviceId}`;
    }
  });

  it("recomputes the totals, keeps the number and answers version 2 as ETag", async () => {
    const invoice = await issued(C.branchD, [free("1000")]);
    const since = new Date();
    const res = await edit(C.admin.cookie, invoice.id, [free("1000"), free("500")], '"1"');
    expect(res.statusCode).toBe(200);
    expect(res.headers["etag"]).toBe('"2"');
    expect((res.json() as Answer).invoice).toMatchObject({
      number: invoice.number,
      version: 2,
      totalMinor: "1500",
    });
    const [row] = await auditSince(h, C.clinicId, since);
    expect(row).toMatchObject({
      action: "invoice.edited",
      details: { before: { totalMinor: "1000" }, after: { totalMinor: "1500" } },
    });
  });

  it("needs If-Match (428) and refuses a stale one (412)", async () => {
    const invoice = await issued(C.branchD, [free("1000")]);
    const missing = await edit(C.admin.cookie, invoice.id, [free("900")]);
    expect([missing.statusCode, code(missing)]).toEqual([428, "precondition_required"]);
    const stale = await edit(C.admin.cookie, invoice.id, [free("900")], '"7"');
    expect([stale.statusCode, code(stale)]).toEqual([412, "version_conflict"]);
  });

  it("lets two concurrent edits of one version through once", async () => {
    const invoice = await issued(C.branchD, [free("1000")]);
    const results = await Promise.all([
      edit(C.admin.cookie, invoice.id, [free("800")], '"1"'),
      edit(C.admin.cookie, invoice.id, [free("700")], '"1"'),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 412]);
  });
});

// PR #78 review: the lines' foreign key refuses a doctor of no clinic; issue answered 400, edit 500.
describe("edit with a line doctor who is no member of the clinic", () => {
  it("is validation (400), not a server error", async () => {
    await send(h, C.admin.cookie, "PATCH", `/v1/services/${C.serviceId}/price`, {
      priceMinor: "1000",
    });
    const invoice = await issued(C.branchD, [free("1000")]);
    const line = {
      kind: "service",
      serviceId: C.serviceId,
      providerId: randomUUID(),
      quantity: 1,
      unitPriceMinor: "1000",
      discount: null,
    };
    const res = await edit(C.admin.cookie, invoice.id, [line], '"1"');
    expect([res.statusCode, code(res)]).toEqual([400, "validation"]);
  });
});

describe("discounts on edit (R1-14)", () => {
  it("lets the desk change a line of an admin-discounted invoice without the discount key", async () => {
    const invoice = await issued(C.branchR, [free("1000", pct(1000)), free("200")]);
    const res = await edit(
      C.desk.cookie,
      invoice.id,
      [free("1000", pct(1000)), free("300")],
      '"1"',
    );
    expect(res.statusCode).toBe(200);
  });

  it("refuses the desk a change of the discount's reason", async () => {
    const invoice = await issued(C.branchR, [free("1000", pct(1000))]);
    const res = await edit(C.desk.cookie, invoice.id, [free("1000", pct(1000, "loyalty"))], '"1"');
    expect(res.statusCode).toBe(403);
  });

  // PR #78 review: an undiscounted line is not a discount; the desk adds and removes one freely.
  it("lets the desk add and remove an undiscounted line without the discount key", async () => {
    const invoice = await issued(C.branchR, [free("1000")]);
    const added = await edit(C.desk.cookie, invoice.id, [free("1000"), free("200")], '"1"');
    expect(added.statusCode).toBe(200);
    const removed = await edit(C.desk.cookie, invoice.id, [free("1000")], '"2"');
    expect(removed.statusCode).toBe(200);
  });

  // PR #78 review (Codex P1): two identical lines compare equal, so the position decides.
  it("refuses the desk a discount moved between two identical lines", async () => {
    const invoice = await issued(C.branchR, [free("1000", pct(1000)), free("1000")]);
    const res = await edit(
      C.desk.cookie,
      invoice.id,
      [free("1000"), free("1000", pct(1000))],
      '"1"',
    );
    expect(res.statusCode).toBe(403);
  });

  it("refuses the desk a discount moved onto another line", async () => {
    const invoice = await issued(C.branchR, [free("1000", pct(1000)), free("5000")]);
    const res = await edit(
      C.desk.cookie,
      invoice.id,
      [free("1000"), free("5000", pct(1000))],
      '"1"',
    );
    expect(res.statusCode).toBe(403);
  });
});

describe("the author of a discount (EY-10.2)", () => {
  it("keeps the author of an unchanged discount and gives a changed one to the editor", async () => {
    const invoice = await issued(C.branchR, [free("1000", pct(1000))], null, pct(500));
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
});

describe("void (FIN-8)", () => {
  it("keeps the number, lets the source be billed again and refuses a later edit", async () => {
    await send(h, C.admin.cookie, "PATCH", `/v1/services/${C.serviceId}/price`, {
      priceMinor: "5000",
    });
    const patient = await patientIn(h, C, C.branchD);
    const appointment = await serviceAppointment(h, C, patient, "17:00");
    const invoice = await issued(C.branchD, [free("5000")], appointment);
    const voided = await voidIt(C.admin.cookie, invoice.id, '"1"');
    expect(voided.statusCode).toBe(200);
    expect((voided.json() as Answer).invoice).toMatchObject({
      number: invoice.number,
      status: "void",
      version: 2,
    });
    expect((await issued(C.branchD, [free("5000")], appointment)).number).not.toBe(invoice.number);
    const late = await edit(C.admin.cookie, invoice.id, [free("1")], '"2"');
    expect([late.statusCode, code(late)]).toEqual([409, "invoice_void"]);
  });

  it("stores the reason on the invoice and only its length in the audit", async () => {
    const invoice = await issued(C.branchD, [free("1000")]);
    const since = new Date();
    await voidIt(C.admin.cookie, invoice.id, '"1"');
    const [row] = await auditSince(h, C.clinicId, since);
    expect(row).toMatchObject({ action: "invoice.voided", details: { reasonLength: 12 } });
    expect(JSON.stringify(row!["details"])).not.toContain("issued twice");
  });

  it("is refused to the desk, which holds no deactivate key", async () => {
    const invoice = await issued(C.branchR, [free("1000")]);
    expect((await voidIt(C.desk.cookie, invoice.id, '"1"')).statusCode).toBe(403);
  });
});
