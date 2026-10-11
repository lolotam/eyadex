import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { addPatient } from "../../appointments/__tests__/appointment-fixtures.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import {
  appointmentFor,
  medicalAudit,
  medicalClinic,
  patientIn,
  startVisit,
  type MedicalClinic,
} from "./medical-fixtures.ts";

// P2-2 (spec §4, ADR-0029): a visit starts from an arrived appointment of the caller, or as a walk-in in
// a branch the caller works in, once per appointment even under concurrency.
let h: Harness;
let C: MedicalClinic;

type Started = { visit: { visit: { id: string; status: string; appointmentId: string | null } } };
const visitOf = (res: { json: () => unknown }) => (res.json() as Started).visit.visit;

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await medicalClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
});

afterAll(() => closeHarness(h));

describe("from an appointment", () => {
  it("the provider starts a draft once the patient arrived, audited without content", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const appointment = await appointmentFor(h, C, patient, "09:00");
    const since = new Date();
    const res = await startVisit(h, C.doctor.cookie, { appointmentId: appointment });
    expect(res.statusCode).toBe(201);
    const visit = visitOf(res);
    expect(visit).toMatchObject({ status: "draft", appointmentId: appointment });
    const rows = await medicalAudit(h, C.clinicId, since);
    expect(rows.map((r) => [r["action"], r["category"], r["entity_type"]])).toEqual([
      ["visit.started", "patient_access", "visit"],
    ]);
    expect(rows[0]!["details"]).toEqual({ before: null, after: { changed: ["status"] } });
  });

  it("a booked (not arrived) appointment is appointment_not_arrived", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const appointment = await appointmentFor(h, C, patient, "10:00", { arrived: false });
    const res = await startVisit(h, C.doctor.cookie, { appointmentId: appointment });
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe("appointment_not_arrived");
  });

  it("another provider's appointment is forbidden; an unknown one not_found", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const appointment = await appointmentFor(h, C, patient, "11:00", {
      providerMembershipId: C.doctorB.memberId,
    });
    expect(code(await startVisit(h, C.doctor.cookie, { appointmentId: appointment }))).toBe(
      "forbidden",
    );
    const unknown = await startVisit(h, C.doctor.cookie, { appointmentId: randomUUID() });
    expect(unknown.statusCode).toBe(404);
  });

  it("a second start is visit_exists naming the live visit; a cancelled one frees the appointment", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const appointment = await appointmentFor(h, C, patient, "12:00");
    const first = visitOf(await startVisit(h, C.doctor.cookie, { appointmentId: appointment }));
    const again = await startVisit(h, C.doctor.cookie, { appointmentId: appointment });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: "visit_exists", details: { visitId: first.id } });
    const cancel = await send(h, C.doctor.cookie, "POST", `/v1/visits/${first.id}/cancel`, {
      reason: "opened_by_mistake",
      note: null,
    });
    expect(cancel.statusCode).toBe(200);
    expect((await startVisit(h, C.doctor.cookie, { appointmentId: appointment })).statusCode).toBe(
      201,
    );
  });

  it("two concurrent starts for one appointment: exactly one visit", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const appointment = await appointmentFor(h, C, patient, "13:00");
    const results = await Promise.all(
      [0, 1, 2].map(() => startVisit(h, C.doctor.cookie, { appointmentId: appointment })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
    const [row] = await h.owner`SELECT count(*)::int AS n FROM visits
                               WHERE clinic_id = ${C.clinicId} AND appointment_id = ${appointment}`;
    expect(row!["n"]).toBe(1);
  });

  it("a replay with the same key answers the same visit; another body is idempotency_conflict", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const appointment = await appointmentFor(h, C, patient, "14:00");
    const key = randomUUID();
    const first = await startVisit(h, C.doctor.cookie, { appointmentId: appointment }, key);
    const replay = await startVisit(h, C.doctor.cookie, { appointmentId: appointment }, key);
    expect(replay.statusCode).toBe(201);
    expect(visitOf(replay).id).toBe(visitOf(first).id);
    const other = await startVisit(
      h,
      C.doctor.cookie,
      { patientId: patient, branchId: C.branchD },
      key,
    );
    expect(code(other)).toBe("idempotency_conflict");
    const [stored] = await h.owner`SELECT response::text AS raw FROM clinic_idempotency_keys
                                   WHERE clinic_id = ${C.clinicId} AND key = ${key}`;
    expect(JSON.parse(stored!["raw"] as string)).toEqual({ id: visitOf(first).id });
  });
});

describe("walk-in", () => {
  it("in a branch the doctor works in, for a file of that branch", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const res = await startVisit(h, C.doctor.cookie, { patientId: patient, branchId: C.branchD });
    expect(res.statusCode).toBe(201);
    expect(visitOf(res)).toMatchObject({ status: "draft", appointmentId: null });
  });

  it("another branch is forbidden; a file of another branch is not_found", async () => {
    const inR = await patientIn(h, C, C.branchR);
    expect(
      code(await startVisit(h, C.doctor.cookie, { patientId: inR, branchId: C.branchR })),
    ).toBe("forbidden");
    expect(
      (await startVisit(h, C.doctor.cookie, { patientId: inR, branchId: C.branchD })).statusCode,
    ).toBe(404);
  });

  it("an archived file of the branch is patient_inactive", async () => {
    const archived = await addPatient(h, C.clinicId, C.branchD, "archived");
    expect(
      code(await startVisit(h, C.doctor.cookie, { patientId: archived, branchId: C.branchD })),
    ).toBe("patient_inactive");
  });

  it("only a holder of create:visits:own starts a visit", async () => {
    const patient = await patientIn(h, C, C.branchR);
    const front = await startVisit(h, C.front.cookie, { patientId: patient, branchId: C.branchR });
    expect(front.statusCode).toBe(403);
    const admin = await startVisit(h, C.admin.cookie, { patientId: patient, branchId: C.branchR });
    expect(admin.statusCode).toBe(403);
  });

  it("refuses a missing Idempotency-Key before anything is written", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const body = { patientId: patient, branchId: C.branchD };
    const res = await send(h, C.doctor.cookie, "POST", "/v1/visits", body);
    expect(code(res)).toBe("validation");
  });
});
