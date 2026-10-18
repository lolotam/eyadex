import { randomUUID } from "node:crypto";

import { invoiceListResponseSchema } from "@eyadex/contracts/finance";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import {
  financeClinic,
  manualInvoice,
  namedPatient,
  serviceAppointment,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

// Plan Task 8d (spec §3.3, §8 rule 12): the list and the detail inside the caller's view reach.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;

type Page = {
  items: { id: string; number: string; patientName: string }[];
  nextCursor: string | null;
  total: number;
};

const list = (cookie: string, query = "") => send(h, cookie, "GET", `/v1/invoices${query}`);
const detail = (cookie: string, id: string) => send(h, cookie, "GET", `/v1/invoices/${id}`);
const ids = (res: { json: () => unknown }) => (res.json() as Page).items.map((i) => i.id);

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
  await h.owner`UPDATE branches SET invoice_prefix = 'TESTX' WHERE id = ${C.branchX}`;
});

afterAll(() => closeHarness(h));

describe("list", () => {
  // PR #77 review: a cursor the list never made restarted at page one with 200.
  it.each(["abc", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"])("refuses the cursor %s", async (cursor) => {
    const res = await list(C.admin.cookie, `?cursor=${cursor}`);
    expect([res.statusCode, code(res)]).toEqual([400, "validation"]);
  });

  it("pages Arabic patient names newest first across a cursor boundary without any audit writes", async () => {
    const patient = await namedPatient(h, C, C.branchX, "مراجع تجريبي أول");
    const other = await namedPatient(h, C, C.branchX, "مراجع تجريبي ثان");
    const first = await manualInvoice(h, C.admin.cookie, patient, C.branchX);
    const second = await manualInvoice(h, C.admin.cookie, other, C.branchX);
    await manualInvoice(h, C.admin.cookie, other, C.branchX);
    const before =
      await h.owner`SELECT id, category FROM audit_log WHERE clinic_id = ${C.clinicId}`;
    const page1 = await list(C.admin.cookie, `?branchId=${C.branchX}&limit=2`);
    expect(page1.statusCode).toBe(200);
    const parsed = invoiceListResponseSchema.parse(page1.json());
    expect(parsed).toMatchObject({
      items: [
        { patientName: "مراجع تجريبي ثان" },
        { id: second.id, patientName: "مراجع تجريبي ثان" },
      ],
      total: 3,
    });
    expect(parsed.nextCursor).toBeTypeOf("string");
    const page2 = await list(
      C.admin.cookie,
      `?branchId=${C.branchX}&limit=2&cursor=${parsed.nextCursor}`,
    );
    expect(invoiceListResponseSchema.parse(page2.json())).toMatchObject({
      items: [{ id: first.id, patientName: "مراجع تجريبي أول" }],
      nextCursor: null,
      total: 3,
    });
    const after = await h.owner`SELECT id, category FROM audit_log WHERE clinic_id = ${C.clinicId}`;
    expect(after.filter((row) => row["category"] === "patient_access")).toHaveLength(
      before.filter((row) => row["category"] === "patient_access").length,
    );
    expect(after).toHaveLength(before.length);
  });

  it("finds the live invoice of an appointment by source and source id", async () => {
    await send(h, C.admin.cookie, "PATCH", `/v1/services/${C.serviceId}/price`, {
      priceMinor: "5000",
    });
    const patient = await patientIn(h, C, C.branchD);
    const appointment = await serviceAppointment(h, C, patient, "16:00");
    const issued = await send(
      h,
      C.admin.cookie,
      "POST",
      "/v1/invoices",
      {
        source: "appointment",
        sourceId: appointment,
        patientId: null,
        branchId: null,
        lines: [
          {
            kind: "free",
            descriptionAr: "جلسة",
            descriptionEn: "Session",
            quantity: 1,
            unitPriceMinor: "5000",
            discount: null,
          },
        ],
        invoiceDiscount: null,
      },
      randomUUID(),
    );
    const id = (issued.json() as { invoice: { id: string } }).invoice.id;
    const res = await list(C.admin.cookie, `?source=appointment&sourceId=${appointment}`);
    expect(ids(res)).toEqual([id]);
  });

  it("shows a desk only the invoices of its branches", async () => {
    const hidden = "مراجع تجريبي لفرع آخر";
    const onD = await manualInvoice(
      h,
      C.admin.cookie,
      await namedPatient(h, C, C.branchD, hidden),
      C.branchD,
    );
    const onR = await manualInvoice(
      h,
      C.admin.cookie,
      await namedPatient(h, C, C.branchR, "مراجع تجريبي للاستقبال"),
      C.branchR,
    );
    const res = await list(C.desk.cookie, "?limit=100");
    expect(res.statusCode).toBe(200);
    const seen = ids(res);
    expect(seen).toContain(onR.id);
    expect(seen).not.toContain(onD.id);
    expect(invoiceListResponseSchema.parse(res.json())).toMatchObject({
      items: [{ id: onR.id, patientName: "مراجع تجريبي للاستقبال" }],
      total: 1,
    });
    expect(JSON.stringify(res.json())).not.toContain(hidden);
  });

  it("returns no invoices or names for a branch viewer with an empty branch set", async () => {
    const viewer = await memberOn(
      h,
      C.admin,
      await customRole(h, C.clinicId, ["view:invoices:branch"]),
      { allBranches: false, branchIds: [C.branchR] },
    );
    await h.owner`DELETE FROM membership_branches WHERE clinic_id = ${C.clinicId} AND membership_id = ${viewer.memberId}`;
    await invalidate.clinicChanged(C.clinicId);
    const res = await list(viewer.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it("shows names with view:invoices alone, without view:patients", async () => {
    const viewer = await memberOn(
      h,
      C.admin,
      await customRole(h, C.clinicId, ["view:invoices:clinic"]),
    );
    const patient = await namedPatient(h, C, C.branchD, "مراجع تجريبي لعارض الفواتير");
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD);
    const res = await list(viewer.cookie, `?patientId=${patient}`);
    expect(res.statusCode).toBe(200);
    expect(invoiceListResponseSchema.parse(res.json())).toMatchObject({
      items: [{ id: invoice.id, patientName: "مراجع تجريبي لعارض الفواتير" }],
      total: 1,
    });
  });

  it("is refused to a member without any invoices key", async () => {
    expect((await list(C.priceReader.cookie)).statusCode).toBe(403);
  });
});

describe("detail", () => {
  it("returns the patient's display name on detail and list without opening their file", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD);
    const rowsBefore =
      await h.owner`SELECT id FROM audit_log WHERE clinic_id = ${C.clinicId} AND category = 'patient_access'`;
    const [name] =
      await h.owner`SELECT full_name FROM patients WHERE clinic_id = ${C.clinicId} AND id = ${patient}`;
    const res = await detail(C.admin.cookie, invoice.id);
    expect(res.json()).toMatchObject({ invoice: { patientName: name!["full_name"] } });
    const noReach = await detail(C.doctor.cookie, invoice.id);
    expect([noReach.statusCode, code(noReach)]).toEqual([404, "not_found"]);
    const listed = await list(C.admin.cookie, `?patientId=${patient}`);
    expect((listed.json() as Page).items[0]).toHaveProperty("patientName", name?.["full_name"]);
    const rowsAfter =
      await h.owner`SELECT id FROM audit_log WHERE clinic_id = ${C.clinicId} AND category = 'patient_access'`;
    expect(rowsAfter).toHaveLength(rowsBefore.length);
  });

  it("answers the invoice with its version as ETag", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD);
    const res = await detail(C.admin.cookie, invoice.id);
    expect(res.statusCode).toBe(200);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.json()).toMatchObject({ invoice: { id: invoice.id, number: invoice.number } });
  });

  it("is not_found to a desk for another branch's invoice", async () => {
    const invoice = await manualInvoice(
      h,
      C.admin.cookie,
      await patientIn(h, C, C.branchD),
      C.branchD,
    );
    const res = await detail(C.desk.cookie, invoice.id);
    expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
  });
});

describe("own reach (R1-12)", () => {
  it("shows a doctor the invoice of a visit-only patient in another branch", async () => {
    const patient = await namedPatient(h, C, C.branchR, "مراجع تجريبي للطبيب");
    // Written as the owner: the doctor cannot open a walk-in for a file outside their reach, yet a visit
    // (made through a since-cancelled booking, say) is what makes the patient theirs (R1-18).
    await h.owner`INSERT INTO visits (clinic_id, id, branch_id, patient_id, provider_membership_id,
                    status, started_at, created_at, updated_at)
                  VALUES (${C.clinicId}, ${randomUUID()}, ${C.branchD}, ${patient},
                    ${C.doctor.memberId}, 'draft', now(), now(), now())`;
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchR);
    const shown = await detail(C.doctor.cookie, invoice.id);
    expect(shown.statusCode).toBe(200);
    const listed = await list(C.doctor.cookie, `?patientId=${patient}`);
    expect(ids(listed)).toEqual([invoice.id]);
    // PR #78 review: the doctor's own branch list misses branch R, so its names come with the invoice.
    const [branch] = await h.owner`SELECT name_ar, name_en FROM branches WHERE id = ${C.branchR}`;
    const names = { branchNameAr: branch!["name_ar"], branchNameEn: branch!["name_en"] };
    expect(shown.json()).toMatchObject({ invoice: names });
    expect(listed.json()).toMatchObject({
      items: [{ ...names, patientName: "مراجع تجريبي للطبيب" }],
    });
  });

  it("hides another doctor's patient from the doctor", async () => {
    const hidden = "مراجع تجريبي لطبيب آخر";
    const patient = await namedPatient(h, C, C.branchD, hidden);
    await h.owner`INSERT INTO visits (clinic_id, id, branch_id, patient_id, provider_membership_id,
                    status, started_at, created_at, updated_at)
                  VALUES (${C.clinicId}, ${randomUUID()}, ${C.branchD}, ${patient},
                    ${C.doctorB.memberId}, 'draft', now(), now(), now())`;
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD);
    const res = await detail(C.doctor.cookie, invoice.id);
    expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
    expect(ids(await list(C.doctor.cookie, `?patientId=${patient}`))).toEqual([]);
    const listed = await list(C.doctor.cookie, "?limit=100");
    expect(listed.statusCode).toBe(200);
    expect(JSON.stringify(listed.json())).not.toContain(hidden);
  });
});

// PR #77: the clinic log read only the entity types it knew, so every invoice row was written but never shown.
describe("the clinic audit log", () => {
  it("shows an issued invoice with its amounts as written", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "1000000");
    const res = await send(h, C.admin.cookie, "GET", "/v1/clinic/audit?entity=invoice&limit=100");
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { items: Record<string, unknown>[] }).items;
    const issued = items.find((i) => i["entityId"] === invoice.id);
    expect(issued).toMatchObject({
      action: "invoice.issued",
      entity: "invoice",
      category: "patient_access",
      before: null,
      after: { number: invoice.number, totalMinor: "1000000", subtotalMinor: "1000000" },
    });
  });
});
