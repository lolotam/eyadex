import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import {
  addPatient,
  appointmentAudit,
  at,
  book,
  bookingBody,
  bookingClinic,
  MONDAY,
  SUNDAY,
  TUESDAY,
  WEDNESDAY,
  type BookingClinic,
} from "./appointment-fixtures.ts";
import { code, send } from "./scheduling-fixtures.ts";

// Spec §4 rules 1, 2, 4, 7, 8, 9 and D-3, D-6, D-14 (slice A2, ADR-0026 §11).
let h: Harness;
let C: BookingClinic;
let patient: string;

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await bookingClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
  patient = await addPatient(h, C.clinicId, C.branchD);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("booking inside a shift", () => {
  it("books with the provider's default length, one administrative audit row without the patient", async () => {
    const res = await book(h, C.admin.cookie, bookingBody(C, patient, at(SUNDAY, "09:00")));
    expect(res.statusCode).toBe(201);
    const { appointment } = res.json();
    expect(appointment).toMatchObject({
      status: "booked",
      overbooked: false,
      providerMembershipId: C.doctor.memberId,
      patientId: patient,
      startsAt: at(SUNDAY, "09:00"),
      endsAt: at(SUNDAY, "09:20"),
    });
    const rows = await appointmentAudit(h, C.clinicId, appointment.id);
    expect(rows.map((r) => [r["action"], r["category"], r["entity_type"]])).toEqual([
      ["appointment.booked", "administrative", "appointment"],
    ]);
    expect(rows[0]!["raw"]).not.toContain(appointment.patientName);
    expect(rows[0]!["raw"]).not.toContain(patient);
  });

  it("takes the service's duration when no end is sent; keeps the end the client sent", async () => {
    const withService = await book(
      h,
      C.admin.cookie,
      bookingBody(C, patient, at(SUNDAY, "10:00"), { serviceId: C.serviceId }),
    );
    expect(withService.json().appointment.endsAt).toBe(at(SUNDAY, "10:30"));
    const free = await book(
      h,
      C.admin.cookie,
      bookingBody(C, patient, at(SUNDAY, "11:00"), { endsAt: at(SUNDAY, "11:45") }),
    );
    expect(free.json().appointment.endsAt).toBe(at(SUNDAY, "11:45"));
  });

  it("rule 8: the same key replays the same appointment; another body is a conflict", async () => {
    const key = randomUUID();
    const body = bookingBody(C, patient, at(SUNDAY, "12:00"));
    const first = await book(h, C.admin.cookie, body, key);
    const again = await book(h, C.admin.cookie, body, key);
    expect(again.statusCode).toBe(201);
    expect(again.json().appointment.id).toBe(first.json().appointment.id);
    const other = await book(h, C.admin.cookie, { ...body, startsAt: at(SUNDAY, "13:00") }, key);
    expect(other.statusCode).toBe(409);
    expect(code(other)).toBe("idempotency_conflict");
    const keyless = await send(h, C.admin.cookie, "POST", "/v1/appointments", body);
    expect(code(keyless)).toBe("validation");
  });
});

describe("rule 2 — schedule, time off, overlap (D-6, D-14)", () => {
  it("refuses a slot outside the provider's hours in that branch", async () => {
    const res = await book(h, C.admin.cookie, bookingBody(C, patient, at(SUNDAY, "07:30")));
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe("outside_schedule");
  });

  it("D-14: Sunday 20:00–24:00 + Monday 00:00–01:00 cover 23:45–00:15; a gap at midnight does not", async () => {
    const late = { endsAt: at(MONDAY, "00:15") };
    const across = await book(
      h,
      C.admin.cookie,
      bookingBody(C, patient, at(SUNDAY, "23:45"), late),
    );
    expect(across.statusCode).toBe(201);
    const gap = await book(
      h,
      C.admin.cookie,
      bookingBody(C, patient, at(TUESDAY, "23:45"), { endsAt: at(WEDNESDAY, "00:15") }),
    );
    expect(code(gap)).toBe("outside_schedule");
  });

  it("refuses a slot inside time off, and one overlapping another live appointment", async () => {
    const off = await send(
      h,
      C.admin.cookie,
      "POST",
      `/v1/schedules/${C.doctor.memberId}/time-off`,
      {
        startsAt: at(MONDAY, "15:00"),
        endsAt: at(MONDAY, "16:00"),
        note: null,
      },
    );
    expect(off.statusCode).toBe(201);
    expect(code(await book(h, C.admin.cookie, bookingBody(C, patient, at(MONDAY, "15:30"))))).toBe(
      "provider_time_off",
    );
    expect(
      (await book(h, C.admin.cookie, bookingBody(C, patient, at(MONDAY, "09:00")))).statusCode,
    ).toBe(201);
    const overlap = await book(h, C.admin.cookie, bookingBody(C, patient, at(MONDAY, "09:10")));
    expect(code(overlap)).toBe("appointment_overlap");
    const touching = await book(h, C.admin.cookie, bookingBody(C, patient, at(MONDAY, "09:20")));
    expect(touching.statusCode).toBe(201);
  });

  it("D-3: one person, one place — an overlap in another branch counts too", async () => {
    // The admin works in R (scheduled) and, as an all-branch member, in X with no hours: an overbooked
    // visit in X still blocks the same time in R.
    const inX = bookingBody(C, patient, at(TUESDAY, "10:00"), {
      branchId: C.branchX,
      providerMembershipId: C.admin.memberId,
      overbook: true,
    });
    expect((await book(h, C.admin.cookie, inX)).json().appointment.overbooked).toBe(true);
    const inR = { ...inX, branchId: C.branchR, overbook: false };
    expect(code(await book(h, C.admin.cookie, inR))).toBe("appointment_overlap");
  });
});

describe("D-3 overbook", () => {
  it("a holder books over a refused slot, marked and audited as overbooked", async () => {
    const res = await book(
      h,
      C.admin.cookie,
      bookingBody(C, patient, at(SUNDAY, "06:00"), { overbook: true }),
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().appointment.overbooked).toBe(true);
    const [row] = await appointmentAudit(h, C.clinicId, res.json().appointment.id);
    expect(row!["details"].after.overbooked).toBe(true);
  });

  it("asking for overbook without the key is forbidden, before any rule", async () => {
    const body = bookingBody(C, patient, at(SUNDAY, "09:00"), {
      branchId: C.branchR,
      providerMembershipId: C.admin.memberId,
      overbook: true,
    });
    const res = await book(h, C.front.cookie, body);
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe("forbidden");
  });
});

describe("rules 1 and 7 and the branch scope", () => {
  it("the front desk books in its branch only", async () => {
    const inR = bookingBody(C, patient, at(TUESDAY, "12:00"), {
      branchId: C.branchR,
      providerMembershipId: C.admin.memberId,
    });
    expect((await book(h, C.front.cookie, inR)).statusCode).toBe(201);
    const inD = await book(h, C.front.cookie, bookingBody(C, patient, at(TUESDAY, "12:00")));
    expect(code(inD)).toBe("forbidden");
  });

  it("refuses an archived file, an unknown file, a member not accepting appointments, a provider of another branch", async () => {
    const archived = await addPatient(h, C.clinicId, C.branchD, "archived");
    const slot = at(WEDNESDAY, "09:00");
    expect(code(await book(h, C.admin.cookie, bookingBody(C, archived, slot)))).toBe(
      "patient_inactive",
    );
    expect(code(await book(h, C.admin.cookie, bookingBody(C, randomUUID(), slot)))).toBe(
      "not_found",
    );
    const desk = { providerMembershipId: C.desk.memberId, branchId: C.branchR };
    expect(code(await book(h, C.admin.cookie, bookingBody(C, patient, slot, desk)))).toBe(
      "provider_not_bookable",
    );
    const elsewhere = { branchId: C.branchR };
    expect(code(await book(h, C.admin.cookie, bookingBody(C, patient, slot, elsewhere)))).toBe(
      "provider_not_in_branch",
    );
  });

  it("refuses an inactive service", async () => {
    const off = await send(h, C.admin.cookie, "POST", `/v1/services/${C.serviceId}/deactivate`);
    expect(off.statusCode).toBe(200);
    const res = await book(
      h,
      C.admin.cookie,
      bookingBody(C, patient, at(WEDNESDAY, "10:00"), { serviceId: C.serviceId }),
    );
    expect(code(res)).toBe("service_inactive");
    await send(h, C.admin.cookie, "POST", `/v1/services/${C.serviceId}/reactivate`);
  });

  it("D-15: a 4-minute appointment is refused by the contract", async () => {
    const res = await book(
      h,
      C.admin.cookie,
      bookingBody(C, patient, at(WEDNESDAY, "11:00"), { endsAt: at(WEDNESDAY, "11:04") }),
    );
    expect(code(res)).toBe("validation");
  });
});
