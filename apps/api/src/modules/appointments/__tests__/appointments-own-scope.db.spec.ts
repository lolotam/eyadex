import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { customRole, memberOn, setMaxUsers } from "../../identity/__tests__/user-fixtures.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import {
  addPatient,
  at,
  book,
  bookingBody,
  bookingClinic,
  SUNDAY,
  type BookingClinic,
} from "./appointment-fixtures.ts";
import { code, send } from "./scheduling-fixtures.ts";

// ADR-0026 A3, spec §3 and §8: `view:appointments:own` reaches the caller's own appointments only, the
// wider key held beside it wins, and the response never names another provider.
let h: Harness;
let C: BookingClinic;
let patient: string;
let own: { cookie: string; memberId: string; fullName: string };
let doctorName: string;

type Day = {
  providers: { membershipId: string; fullName: string }[];
  appointments: { id: string; providerMembershipId: string }[];
  can: { create: boolean; update: boolean; overbook: boolean };
};

const day = (cookie: string, branchId: string) =>
  send(h, cookie, "GET", `/v1/appointments/day?branchId=${branchId}&date=${SUNDAY}`);

/** A member of branch D holding `keys`, bookable there 08:00–20:00 every day when `bookable`. */
async function memberWith(keys: string[], bookable = true, branchIds = [C.branchD]) {
  const role = await customRole(h, C.clinicId, keys);
  const member = await memberOn(h, C.admin, role, { allBranches: false, branchIds });
  const [row] = await h.owner`SELECT full_name FROM memberships WHERE id = ${member.memberId}`;
  if (bookable) {
    const put = (url: string, body: unknown) => send(h, C.admin.cookie, "PUT", url, body);
    await put(`/v1/users/${member.memberId}/booking-profile`, {
      acceptsAppointments: true,
      defaultDurationMinutes: 20,
    });
    const shifts = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      startsAt: "08:00",
      endsAt: "20:00",
    }));
    const week = await put(`/v1/schedules/${member.memberId}/branches/${C.branchD}`, { shifts });
    if (week.statusCode !== 200) throw new Error(`schedule ${week.statusCode} ${week.body}`);
  }
  return { ...member, fullName: row!["full_name"] as string };
}

async function bookFor(providerMembershipId: string, time: string, cookie = C.admin.cookie) {
  const res = await book(
    h,
    cookie,
    bookingBody(C, patient, at(SUNDAY, time), { providerMembershipId }),
  );
  return res;
}

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await bookingClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
  await setMaxUsers(h, C.clinicId, 50);
  patient = await addPatient(h, C.clinicId, C.branchD);
  own = await memberWith(["view:appointments:own"]);
  const [doctor] = await h.owner`SELECT full_name FROM memberships WHERE id = ${C.doctor.memberId}`;
  doctorName = doctor!["full_name"] as string;
  for (const [provider, time] of [
    [own.memberId, "09:00"],
    [own.memberId, "11:00"],
    [C.doctor.memberId, "09:00"],
  ] as const) {
    const res = await bookFor(provider, time);
    if (res.statusCode !== 201) throw new Error(`book ${res.statusCode} ${res.body}`);
  }
});
afterAll(async () => {
  await closeHarness(h);
});

describe("view:appointments:own (ADR-0026 A3)", () => {
  it("lists the active branches of the caller's own membership", async () => {
    const res = await send(h, own.cookie, "GET", "/v1/appointments/branches");
    expect(res.statusCode).toBe(200);
    expect((res.json() as { items: { id: string }[] }).items.map((b) => b.id)).toEqual([C.branchD]);
  });

  it("shows only the caller's column and appointments, naming no other provider", async () => {
    const res = await day(own.cookie, C.branchD);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Day;
    expect(body.providers.map((p) => p.membershipId)).toEqual([own.memberId]);
    expect(body.appointments).toHaveLength(2);
    expect(body.appointments.every((a) => a.providerMembershipId === own.memberId)).toBe(true);
    expect(body.can).toEqual({ create: false, update: false, overbook: false });
    expect(res.body).not.toContain(C.doctor.memberId);
    expect(res.body).not.toContain(doctorName);
  });

  it("a branch outside the caller's membership is not_found", async () => {
    const res = await day(own.cookie, C.branchR);
    expect(res.statusCode).toBe(404);
    expect(code(res)).toBe("not_found");
  });

  it("a branch of the membership where the caller has no column is an empty day, not not_found", async () => {
    const idle = await memberWith(["view:appointments:own"], false, [C.branchD, C.branchR]);
    const res = await day(idle.cookie, C.branchD);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Day;
    expect(body.providers).toEqual([]);
    expect(body.appointments).toEqual([]);
    expect(res.body).not.toContain(C.doctor.memberId);
  });

  it("a write answer shows the appointment only when its provider is the caller", async () => {
    const booker = await memberWith(["view:appointments:own", "create:appointments:branch"]);
    const mine = await bookFor(booker.memberId, "13:00", booker.cookie);
    expect(mine.statusCode).toBe(201);
    expect(mine.json().appointment?.providerMembershipId).toBe(booker.memberId);
    const theirs = await bookFor(C.doctor.memberId, "13:00", booker.cookie);
    expect(theirs.statusCode).toBe(201);
    expect(theirs.json()).toEqual({ appointment: null });
  });

  it("the wider key held beside own wins: branch shows every column of the branch", async () => {
    const both = await memberWith(["view:appointments:own", "view:appointments:branch"], false);
    const body = (await day(both.cookie, C.branchD)).json() as Day;
    expect(body.providers.map((p) => p.membershipId)).toEqual(
      expect.arrayContaining([own.memberId, C.doctor.memberId]),
    );
    expect(body.appointments.length).toBeGreaterThanOrEqual(3);
  });

  it("branch and clinic holders are unchanged", async () => {
    const front = (await day(C.front.cookie, C.branchR)).json() as Day;
    expect(front.providers.map((p) => p.membershipId)).toContain(C.admin.memberId);
    expect(front.can.create).toBe(true);
    expect((await day(C.front.cookie, C.branchD)).statusCode).toBe(404);
    const admin = (await day(C.admin.cookie, C.branchD)).json() as Day;
    expect(admin.providers.map((p) => p.membershipId)).toEqual(
      expect.arrayContaining([own.memberId, C.doctor.memberId]),
    );
    expect(admin.appointments.length).toBeGreaterThanOrEqual(3);
  });
});
