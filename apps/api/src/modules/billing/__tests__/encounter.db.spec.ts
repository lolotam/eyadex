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
import { patientIn, startedVisit } from "../../medical/__tests__/medical-fixtures.ts";
import {
  financeClinic,
  serviceAppointment,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

// PR #78 review: an appointment and the visit made from it are one encounter, billed once. A live invoice
// on either one refuses the other, in the draft and the issue, both ways; a void frees it again.
let h: Harness;
let C: FinanceClinic;

beforeAll(async () => {
  h = await openHarness({}, true);
  const invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
});

afterAll(() => closeHarness(h));

const line = {
  kind: "free",
  descriptionAr: "كشف",
  descriptionEn: "Consultation",
  quantity: 1,
  unitPriceMinor: "1000",
  discount: null,
};
const issue = (source: "appointment" | "visit", sourceId: string) =>
  send(
    h,
    C.admin.cookie,
    "POST",
    "/v1/invoices",
    { source, sourceId, patientId: null, branchId: null, lines: [line], invoiceDiscount: null },
    randomUUID(),
  );
const draft = (source: "appointment" | "visit", id: string) =>
  send(h, C.admin.cookie, "GET", `/v1/invoices/draft?source=${source}&id=${id}`);

async function encounter(time: string) {
  const patient = await patientIn(h, C, C.branchD);
  const appointment = await serviceAppointment(h, C, patient, time);
  const visit = await startedVisit(h, C.doctor.cookie, { appointmentId: appointment });
  return { appointment, visit };
}

describe("one encounter, one live invoice", () => {
  it("refuses the visit once its appointment is billed", async () => {
    const { appointment, visit } = await encounter("09:00");
    expect((await issue("appointment", appointment)).statusCode).toBe(201);
    const again = await issue("visit", visit);
    expect([again.statusCode, code(again)]).toEqual([409, "invoice_already_exists"]);
    const drafted = await draft("visit", visit);
    expect([drafted.statusCode, code(drafted)]).toEqual([409, "invoice_already_exists"]);
  });

  it("refuses the appointment once its visit is billed", async () => {
    const { appointment, visit } = await encounter("10:00");
    expect((await issue("visit", visit)).statusCode).toBe(201);
    const again = await issue("appointment", appointment);
    expect([again.statusCode, code(again)]).toEqual([409, "invoice_already_exists"]);
    const drafted = await draft("appointment", appointment);
    expect([drafted.statusCode, code(drafted)]).toEqual([409, "invoice_already_exists"]);
  });

  it("bills the visit again once the appointment's invoice is void", async () => {
    const { appointment, visit } = await encounter("11:00");
    const first = (await issue("appointment", appointment)).json() as { invoice: { id: string } };
    const voided = await call(h, {
      method: "POST",
      url: `/v1/invoices/${first.invoice.id}/void`,
      host: APP,
      cookie: C.admin.cookie,
      body: { reason: "billed on the visit" },
      headers: { "if-match": '"1"' },
    });
    expect(voided.statusCode).toBe(200);
    expect((await issue("visit", visit)).statusCode).toBe(201);
  });
});
