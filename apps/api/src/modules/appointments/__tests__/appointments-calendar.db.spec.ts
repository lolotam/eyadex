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
  MONDAY,
  SUNDAY,
  type BookingClinic,
} from "./appointment-fixtures.ts";
import { code, send } from "./scheduling-fixtures.ts";

// Slice A4 (spec §5): the provider week and the month read the live appointments of one branch, follow
// the day's branch rule, and under `own` read the caller's own provider only (ADR-0026 A3).
let h: Harness;
let C: BookingClinic;
let patient: string;
let own: { cookie: string; memberId: string };
const NEXT_SUNDAY = "2027-03-14";

type Week = {
  provider: { membershipId: string; bookable: boolean };
  days: { date: string; shifts: { startsAt: string; endsAt: string }[] }[];
  appointments: { providerMembershipId: string; startsAt: string }[];
  can: { create: boolean };
};
type Month = { month: string; days: { date: string; count: number }[] };

const week = (cookie: string, providerId: string, branchId = C.branchD, weekStart = SUNDAY) =>
  send(
    h,
    cookie,
    "GET",
    `/v1/appointments/week?branchId=${branchId}&providerMembershipId=${providerId}&weekStart=${weekStart}`,
  );
const month = (cookie: string, query: string) =>
  send(h, cookie, "GET", `/v1/appointments/month?branchId=${C.branchD}&${query}`);
const countOn = (body: Month, date: string) => body.days.find((d) => d.date === date)?.count;

async function bookOn(providerMembershipId: string, date: string, time: string): Promise<string> {
  const res = await book(
    h,
    C.admin.cookie,
    bookingBody(C, patient, at(date, time), { providerMembershipId }),
  );
  if (res.statusCode !== 201) throw new Error(`book ${res.statusCode} ${res.body}`);
  return (res.json() as { appointment: { id: string } }).appointment.id;
}

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await bookingClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
  await setMaxUsers(h, C.clinicId, 50);
  patient = await addPatient(h, C.clinicId, C.branchD);
  const role = await customRole(h, C.clinicId, ["view:appointments:own"]);
  own = await memberOn(h, C.admin, role, { allBranches: false, branchIds: [C.branchD] });
  await send(h, C.admin.cookie, "PUT", `/v1/users/${own.memberId}/booking-profile`, {
    acceptsAppointments: true,
    defaultDurationMinutes: 20,
  });
  const shifts = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    startsAt: "08:00",
    endsAt: "20:00",
  }));
  await send(h, C.admin.cookie, "PUT", `/v1/schedules/${own.memberId}/branches/${C.branchD}`, {
    shifts,
  });
  await bookOn(C.doctor.memberId, SUNDAY, "09:00");
  await bookOn(C.doctor.memberId, MONDAY, "10:00");
  await bookOn(C.doctor.memberId, NEXT_SUNDAY, "09:00");
  const cancelled = await bookOn(C.doctor.memberId, SUNDAY, "11:00");
  const cancel = await send(h, C.admin.cookie, "POST", `/v1/appointments/${cancelled}/cancel`, {
    reason: "patient_cancelled",
    note: null,
  });
  if (cancel.statusCode !== 200) throw new Error(`cancel ${cancel.statusCode} ${cancel.body}`);
  await bookOn(own.memberId, SUNDAY, "12:00");
});
afterAll(async () => {
  await closeHarness(h);
});

describe("GET /v1/appointments/week (A4)", () => {
  it("returns seven days of the provider's rows in this branch and its live appointments that week", async () => {
    const res = await week(C.admin.cookie, C.doctor.memberId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Week;
    expect(body.days.map((d) => d.date)).toEqual([
      SUNDAY,
      MONDAY,
      "2027-03-09",
      "2027-03-10",
      "2027-03-11",
      "2027-03-12",
      "2027-03-13",
    ]);
    expect(body.days[0]!.shifts).toEqual([
      { startsAt: "08:00", endsAt: "20:00" },
      { startsAt: "20:00", endsAt: "24:00" },
    ]);
    expect(body.provider).toMatchObject({ membershipId: C.doctor.memberId, bookable: true });
    expect(body.appointments.map((a) => a.startsAt)).toEqual([
      at(SUNDAY, "09:00"),
      at(MONDAY, "10:00"),
    ]);
    expect(body.appointments.every((a) => a.providerMembershipId === C.doctor.memberId)).toBe(true);
    expect(body.can.create).toBe(true);
  });

  it("a provider without rows in the branch has an empty week (bookable as on the day)", async () => {
    const body = (await week(C.admin.cookie, C.admin.memberId)).json() as Week;
    expect(body.provider.bookable).toBe(true); // the admin works in every branch
    expect(body.days.every((d) => d.shifts.length === 0)).toBe(true);
    expect(body.appointments).toEqual([]);
  });

  it("under own the caller reads its own week, and another provider is not_found", async () => {
    const mine = await week(own.cookie, own.memberId);
    expect(mine.statusCode).toBe(200);
    expect((mine.json() as Week).appointments).toHaveLength(1);
    const theirs = await week(own.cookie, C.doctor.memberId);
    expect(theirs.statusCode).toBe(404);
    expect(code(theirs)).toBe("not_found");
    expect(theirs.body).not.toContain(C.doctor.memberId);
  });

  it("a branch outside the caller's view keys is not_found", async () => {
    const res = await week(C.front.cookie, C.doctor.memberId, C.branchD);
    expect(res.statusCode).toBe(404);
    expect(code(res)).toBe("not_found");
  });

  it("refuses a week start that is not a real date", async () => {
    const res = await week(C.admin.cookie, C.doctor.memberId, C.branchD, "2027-02-29");
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/appointments/month (A4)", () => {
  it("lists every day of the month with the branch's live appointments counted on their start day", async () => {
    const res = await month(C.admin.cookie, "month=2027-03");
    expect(res.statusCode).toBe(200);
    const body = res.json() as Month;
    expect(body.days).toHaveLength(31);
    expect(body.days[0]!.date).toBe("2027-03-01");
    expect(countOn(body, SUNDAY)).toBe(2);
    expect(countOn(body, MONDAY)).toBe(1);
    expect(countOn(body, NEXT_SUNDAY)).toBe(1);
    expect(countOn(body, "2027-03-02")).toBe(0);
  });

  it("narrows to one provider when asked", async () => {
    const body = (
      await month(C.admin.cookie, `month=2027-03&providerMembershipId=${C.doctor.memberId}`)
    ).json() as Month;
    expect(countOn(body, SUNDAY)).toBe(1);
  });

  it("under own counts the caller's own only, and naming another provider is not_found", async () => {
    const mine = (await month(own.cookie, "month=2027-03")).json() as Month;
    expect(countOn(mine, SUNDAY)).toBe(1);
    expect(countOn(mine, MONDAY)).toBe(0);
    const theirs = await month(
      own.cookie,
      `month=2027-03&providerMembershipId=${C.doctor.memberId}`,
    );
    expect(theirs.statusCode).toBe(404);
  });

  it("refuses a month that does not exist", async () => {
    expect((await month(C.admin.cookie, "month=2027-13")).statusCode).toBe(400);
  });
});
