import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn, startedVisit } from "../../medical/__tests__/medical-fixtures.ts";
import { financeClinic, serviceAppointment, type FinanceClinic } from "./billing-fixtures.ts";

// Plan Task 8b (FIN-A8, R1-7): the draft takes its patient, branch, service and price from the source.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;

const draft = (cookie: string, source: string, id: string) =>
  send(h, cookie, "GET", `/v1/invoices/draft?source=${source}&id=${id}`);
const setPrice = (priceMinor: string | null) =>
  send(h, C.admin.cookie, "PATCH", `/v1/services/${C.serviceId}/price`, { priceMinor });
const setDoctorPrice = (items: unknown[]) =>
  send(h, C.admin.cookie, "PUT", `/v1/services/${C.serviceId}/provider-prices`, { items });

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
});

afterAll(() => closeHarness(h));

describe("draft from an appointment (R1-7)", () => {
  it("flags a service with no price and gives its line a zero price", async () => {
    await setPrice(null);
    await setDoctorPrice([]);
    const patient = await patientIn(h, C, C.branchD);
    const appointment = await serviceAppointment(h, C, patient, "09:00");
    const res = await draft(C.admin.cookie, "appointment", appointment);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      source: "appointment",
      sourceId: appointment,
      patientId: patient,
      branchId: C.branchD,
      priceMissing: true,
      lines: [
        {
          kind: "service",
          serviceId: C.serviceId,
          providerId: C.doctor.memberId,
          quantity: 1,
          unitPriceMinor: "0",
          discount: null,
        },
      ],
    });
  });

  it("uses the base price, and the doctor's own price over it", async () => {
    await setPrice("15000");
    await setDoctorPrice([]);
    const patient = await patientIn(h, C, C.branchD);
    const appointment = await serviceAppointment(h, C, patient, "10:00");
    const base = await draft(C.admin.cookie, "appointment", appointment);
    expect(base.json()).toMatchObject({
      priceMissing: false,
      lines: [{ unitPriceMinor: "15000" }],
    });
    await setDoctorPrice([{ memberId: C.doctor.memberId, priceMinor: "22000" }]);
    const own = await draft(C.admin.cookie, "appointment", appointment);
    expect(own.json()).toMatchObject({ lines: [{ unitPriceMinor: "22000" }] });
  });

  it("is not_found outside the caller's branches and for an id of no clinic", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const appointment = await serviceAppointment(h, C, patient, "11:00");
    const outside = await draft(C.desk.cookie, "appointment", appointment);
    expect([outside.statusCode, code(outside)]).toEqual([404, "not_found"]);
    const unknown = await draft(C.admin.cookie, "appointment", randomUUID());
    expect([unknown.statusCode, code(unknown)]).toEqual([404, "not_found"]);
  });

  it("is refused to a doctor, who may only view the invoices of their own patients", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const appointment = await serviceAppointment(h, C, patient, "12:00");
    const res = await draft(C.doctor.cookie, "appointment", appointment);
    expect(res.statusCode).toBe(403);
  });
});

describe("draft from a visit (R1-7)", () => {
  it("takes the service of the visit's appointment", async () => {
    await setPrice("15000");
    await setDoctorPrice([]);
    const patient = await patientIn(h, C, C.branchD);
    const appointment = await serviceAppointment(h, C, patient, "13:00");
    const visit = await startedVisit(h, C.doctor.cookie, { appointmentId: appointment });
    const res = await draft(C.admin.cookie, "visit", visit);
    expect(res.json()).toMatchObject({
      source: "visit",
      patientId: patient,
      branchId: C.branchD,
      lines: [{ serviceId: C.serviceId, unitPriceMinor: "15000" }],
    });
  });

  it("gives a walk-in visit an empty draft", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const visit = await startedVisit(h, C.doctor.cookie, {
      patientId: patient,
      branchId: C.branchD,
    });
    const res = await draft(C.admin.cookie, "visit", visit);
    expect(res.json()).toMatchObject({ priceMissing: false, lines: [] });
  });
});
