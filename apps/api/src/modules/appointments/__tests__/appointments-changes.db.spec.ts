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
  SUNDAY,
  type BookingClinic,
} from "./appointment-fixtures.ts";
import { code, send, setAppointmentsModule } from "./scheduling-fixtures.ts";

// Spec §4 rules 5, 6, 9, 10, D-5, D-11 and the branch day of §5 (slice A2, ADR-0026 §11).
let h: Harness;
let invalidate: AuthorizationInvalidator;
let C: BookingClinic;
let other: BookingClinic;
let patient: string;
const DAY = "2027-03-14"; // a Sunday
let minute = 0;

/** A fresh booked appointment of the doctor on branch D, each one later than the last. */
async function booked(clinic = C, cookie = C.admin.cookie, file = patient): Promise<string> {
  minute += 30;
  const time = `${String(8 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const res = await book(h, cookie, bookingBody(clinic, file, at(DAY, time)));
  if (res.statusCode !== 201) throw new Error(`book ${res.statusCode} ${res.body}`);
  return res.json().appointment.id as string;
}

const status = (id: string, value: string, cookie = C.admin.cookie) =>
  send(h, cookie, "POST", `/v1/appointments/${id}/status`, { status: value });
const cancel = (id: string, body: unknown, cookie = C.admin.cookie) =>
  send(h, cookie, "POST", `/v1/appointments/${id}/cancel`, body);
const move = (id: string, startsAt: string, endsAt: string, extra: Record<string, unknown> = {}) =>
  send(h, C.admin.cookie, "PUT", `/v1/appointments/${id}`, {
    branchId: C.branchD,
    providerMembershipId: C.doctor.memberId,
    startsAt,
    endsAt,
    overbook: false,
    ...extra,
  });

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await bookingClinic(h, invalidate);
  other = await bookingClinic(h, invalidate);
  patient = await addPatient(h, C.clinicId, C.branchD);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("rule 6 — reschedule", () => {
  it("moves a booked appointment through the same checks; the audit keeps old and new times", async () => {
    const id = await booked();
    const res = await move(id, at(SUNDAY, "14:00"), at(SUNDAY, "14:30"));
    expect(res.statusCode).toBe(200);
    expect(res.json().appointment).toMatchObject({ startsAt: at(SUNDAY, "14:00") });
    const rows = await appointmentAudit(h, C.clinicId, id);
    expect(rows.map((r) => r["action"])).toEqual(["appointment.booked", "appointment.rescheduled"]);
    expect(rows[1]!["details"].before.startsAt).not.toBe(rows[1]!["details"].after.startsAt);
    expect(rows[1]!["details"].after.startsAt).toBe(at(SUNDAY, "14:00"));
    expect((await move(id, at(SUNDAY, "14:00"), at(SUNDAY, "14:30"))).statusCode).toBe(200);
    expect(await appointmentAudit(h, C.clinicId, id)).toHaveLength(2);
  });

  it("refuses a move onto another appointment (itself excluded) and outside the hours", async () => {
    const first = await booked();
    const second = await booked();
    const [a] = await h.owner`SELECT starts_at, ends_at FROM appointments WHERE id = ${first}`;
    const onFirst = await move(
      second,
      new Date(a!["starts_at"]).toISOString(),
      new Date(a!["ends_at"]).toISOString(),
    );
    expect(code(onFirst)).toBe("appointment_overlap");
    // Sunday 20:00–24:00 is a shift as well.
    expect((await move(second, at(SUNDAY, "21:00"), at(SUNDAY, "21:30"))).statusCode).toBe(200);
    expect(code(await move(second, at(SUNDAY, "06:00"), at(SUNDAY, "06:30")))).toBe(
      "outside_schedule",
    );
  });

  it("only a booked appointment moves", async () => {
    const id = await booked();
    expect((await status(id, "arrived")).statusCode).toBe(200);
    expect(code(await move(id, at(SUNDAY, "15:00"), at(SUNDAY, "15:30")))).toBe(
      "invalid_transition",
    );
  });
});

describe("D-5 statuses and D-11 cancel", () => {
  it("booked → arrived → completed; completed can never go back", async () => {
    const id = await booked();
    expect((await status(id, "arrived")).json().appointment.status).toBe("arrived");
    expect((await status(id, "completed")).json().appointment.status).toBe("completed");
    const back = await status(id, "arrived");
    expect(back.statusCode).toBe(409);
    expect(code(back)).toBe("invalid_transition");
    expect(code(await status(id, "no_show"))).toBe("invalid_transition");
  });

  it("no-show only from booked; the same status again writes nothing", async () => {
    const id = await booked();
    expect((await status(id, "no_show")).json().appointment.status).toBe("no_show");
    expect((await status(id, "no_show")).statusCode).toBe(200);
    const rows = await appointmentAudit(h, C.clinicId, id);
    expect(rows.map((r) => r["action"])).toEqual([
      "appointment.booked",
      "appointment.status_changed",
    ]);
  });

  it("a cancel needs a reason; the note is kept on the appointment, never in the audit", async () => {
    const id = await booked();
    expect(code(await cancel(id, { note: null }))).toBe("validation");
    const note = `called ${randomUUID().slice(0, 6)}`;
    const res = await cancel(id, { reason: "patient_cancelled", note });
    expect(res.json().appointment).toMatchObject({
      status: "cancelled",
      cancelReason: "patient_cancelled",
      cancelNote: note,
    });
    const rows = await appointmentAudit(h, C.clinicId, id);
    expect(rows.at(-1)!["action"]).toBe("appointment.cancelled");
    expect(rows.at(-1)!["details"].after.cancelReason).toBe("patient_cancelled");
    expect(rows.at(-1)!["raw"]).not.toContain(note);
    expect((await cancel(id, { reason: "other", note: null })).statusCode).toBe(200);
    expect(await appointmentAudit(h, C.clinicId, id)).toHaveLength(2);
    expect(code(await status(id, "arrived"))).toBe("invalid_transition");
  });

  it("a cancelled slot can be booked again", async () => {
    const id = await booked();
    const [row] = await h.owner`SELECT starts_at FROM appointments WHERE id = ${id}`;
    await cancel(id, { reason: "other", note: null });
    const again = await book(
      h,
      C.admin.cookie,
      bookingBody(C, patient, new Date(row!["starts_at"]).toISOString()),
    );
    expect(again.statusCode).toBe(201);
  });
});

describe("scope, isolation and the module flag", () => {
  it("an appointment outside the caller's update reach, or of another clinic, is not found", async () => {
    const id = await booked();
    expect(code(await status(id, "arrived", C.front.cookie))).toBe("not_found");
    const foreign = await addPatient(h, other.clinicId, other.branchD);
    const theirs = await booked(other, other.admin.cookie, foreign);
    expect(code(await status(theirs, "arrived"))).toBe("not_found");
    expect(
      code(
        await send(h, C.admin.cookie, "POST", "/v1/appointments/not-an-id/status", {
          status: "arrived",
        }),
      ),
    ).toBe("not_found");
  });

  it("rule 10: with the module off every route answers module_disabled", async () => {
    await setAppointmentsModule(h, invalidate, other.clinicId, false);
    const day = await send(
      h,
      other.admin.cookie,
      "GET",
      `/v1/appointments/day?branchId=${other.branchD}&date=${DAY}`,
    );
    expect(code(day)).toBe("module_disabled");
    const created = await book(
      h,
      other.admin.cookie,
      bookingBody(other, randomUUID(), at(DAY, "09:00")),
    );
    expect(code(created)).toBe("module_disabled");
    await setAppointmentsModule(h, invalidate, other.clinicId, true);
  });
});

describe("the branch day (spec §5)", () => {
  it("one column per bookable provider of the branch, its hours, and the day's live appointments", async () => {
    const id = await booked();
    const res = await send(
      h,
      C.admin.cookie,
      "GET",
      `/v1/appointments/day?branchId=${C.branchD}&date=${DAY}`,
    );
    expect(res.statusCode).toBe(200);
    const day = res.json();
    expect(day.providers.map((p: { membershipId: string }) => p.membershipId)).toContain(
      C.doctor.memberId,
    );
    const doctor = day.providers.find(
      (p: { membershipId: string }) => p.membershipId === C.doctor.memberId,
    );
    expect(doctor.shifts).toEqual([
      { startsAt: "08:00", endsAt: "20:00" },
      { startsAt: "20:00", endsAt: "24:00" },
    ]);
    const shown = day.appointments.find((a: { id: string }) => a.id === id);
    expect(shown.patientName).toMatch(/^Booked Patient/);
    expect(shown).not.toHaveProperty("patientPhone");
    expect(day.can).toEqual({ create: true, update: true, overbook: true });
  });

  it("the front desk sees its own branch only", async () => {
    const list = await send(h, C.front.cookie, "GET", "/v1/appointments/branches");
    expect(list.json().items.map((b: { id: string }) => b.id)).toEqual([C.branchR]);
    const res = await send(
      h,
      C.front.cookie,
      "GET",
      `/v1/appointments/day?branchId=${C.branchD}&date=${DAY}`,
    );
    expect(code(res)).toBe("not_found");
    const own = await send(
      h,
      C.front.cookie,
      "GET",
      `/v1/appointments/day?branchId=${C.branchR}&date=${DAY}`,
    );
    expect(own.json().can).toEqual({ create: true, update: true, overbook: false });
  });
});
