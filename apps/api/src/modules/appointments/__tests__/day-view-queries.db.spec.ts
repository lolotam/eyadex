import { randomUUID } from "node:crypto";

import type { Database, Tx } from "@eyadex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DATABASE } from "../../../shared/database.provider.ts";
import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { customRole, memberOn, setMaxUsers } from "../../identity/__tests__/user-fixtures.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import type { AppointmentActor } from "../domain/booking-rules.ts";
import type { BookingPatientReader } from "../ports/booking-patient-reader.ts";
import type { ProviderDirectory } from "../ports/provider-directory.ts";
import type { SchedulingBranchReader } from "../ports/scheduling-branch-reader.ts";
import {
  BOOKING_PATIENT_READER,
  PROVIDER_DIRECTORY,
  SCHEDULING_BRANCH_READER,
} from "../ports/tokens.ts";
import { readAppointmentDay } from "../queries/appointment-day.ts";
import {
  addPatient,
  at,
  book,
  bookingBody,
  bookingClinic,
  TZ,
  type BookingClinic,
} from "./appointment-fixtures.ts";
import { send } from "./scheduling-fixtures.ts";

// Codex A2 PR #64: the branch day read schedules, time off and names once per provider column, so a
// branch of P providers cost about 3P round trips. The count must not depend on P.
let h: Harness;
let C: BookingClinic;
let patient: string;
const DAY = "2027-04-04"; // a Sunday (weekday 0)

/** The pool with every statement a tenant transaction runs through `tx.execute` counted. */
function countingDb(db: Database): { db: Database; statements: () => number } {
  let n = 0;
  const counted = (tx: Tx): Tx => ({
    execute: (query) => {
      n += 1;
      return tx.execute(query);
    },
    cursor: tx.cursor,
    rollback: tx.rollback,
    transaction: (fn) => tx.transaction((inner) => fn(counted(inner))),
  });
  const wrapped: Database = {
    ...db,
    withTenant: (clinicId, fn) => db.withTenant(clinicId, (tx) => fn(counted(tx))),
  };
  return { db: wrapped, statements: () => n };
}

async function readCounted(timezone = TZ, date = DAY) {
  const { db, statements } = countingDb(h.app.get<Database>(DATABASE));
  const actor: AppointmentActor = {
    clinicId: C.clinicId,
    userId: C.admin.userId,
    membershipId: C.admin.memberId,
    timezone,
    language: "en",
    permissions: ["view:appointments:clinic"],
    member: { all: true },
  };
  const day = await readAppointmentDay(
    {
      db,
      providers: h.app.get<ProviderDirectory>(PROVIDER_DIRECTORY),
      branches: h.app.get<SchedulingBranchReader>(SCHEDULING_BRANCH_READER),
      patients: h.app.get<BookingPatientReader>(BOOKING_PATIENT_READER),
    },
    actor,
    { branchId: C.branchD, date },
  );
  return { day, statements: statements() };
}

/** A bookable provider of branch D working Sundays `from`–`to`, holding one appointment at `from`. */
async function bookedProvider(from: string, to: string): Promise<string> {
  const role = await customRole(h, C.clinicId, ["view:appointments:branch"]);
  const member = await memberOn(h, C.admin, role, { allBranches: false, branchIds: [C.branchD] });
  const put = (url: string, body: unknown) => send(h, C.admin.cookie, "PUT", url, body);
  await put(`/v1/users/${member.memberId}/booking-profile`, {
    acceptsAppointments: true,
    defaultDurationMinutes: 20,
  });
  const week = await put(`/v1/schedules/${member.memberId}/branches/${C.branchD}`, {
    shifts: [{ weekday: 0, startsAt: from, endsAt: to }],
  });
  if (week.statusCode !== 200) throw new Error(`schedule ${week.statusCode} ${week.body}`);
  const res = await book(
    h,
    C.admin.cookie,
    bookingBody(C, patient, at(DAY, from), { providerMembershipId: member.memberId }),
  );
  if (res.statusCode !== 201) throw new Error(`book ${res.statusCode} ${res.body}`);
  return member.memberId;
}

/** A provider seen only through its appointment: it no longer accepts appointments. */
async function historicalProvider(from: string): Promise<string> {
  const id = await bookedProvider(from, "20:00");
  await h.owner`UPDATE memberships SET accepts_appointments = false WHERE id = ${id}`;
  return id;
}

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await bookingClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
  await setMaxUsers(h, C.clinicId, 50);
  // The admin works in every branch; out of the way, the doctor is the one bookable column.
  await h.owner`UPDATE memberships SET accepts_appointments = false WHERE id = ${C.admin.memberId}`;
  patient = await addPatient(h, C.clinicId, C.branchD);
  const res = await book(h, C.admin.cookie, bookingBody(C, patient, at(DAY, "08:00")));
  if (res.statusCode !== 201) throw new Error(`book ${res.statusCode} ${res.body}`);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("the branch day's statements (Codex A2 PR #64)", () => {
  it("the same number for one bookable column as for many, each column keeping its own rows", async () => {
    const firstHistorical = await historicalProvider("09:00");
    const one = await readCounted();
    expect(one.day.providers.map((p) => p.membershipId).sort()).toEqual(
      [C.doctor.memberId, firstHistorical].sort(),
    );

    const added = [
      await bookedProvider("10:00", "14:00"),
      await bookedProvider("11:00", "15:00"),
      await bookedProvider("12:00", "16:00"),
    ];
    const secondHistorical = await historicalProvider("13:00");
    const off = await send(h, C.admin.cookie, "POST", `/v1/schedules/${added[1]}/time-off`, {
      startsAt: at(DAY, "14:00"),
      endsAt: at(DAY, "15:00"),
      note: null,
    });
    expect(off.statusCode).toBe(201);
    const many = await readCounted();

    expect(many.day.providers).toHaveLength(6);
    expect(many.day.appointments).toHaveLength(6);
    expect(many.statements).toBe(one.statements);

    const column = (id: string) => many.day.providers.find((p) => p.membershipId === id)!;
    expect(column(added[0]!).shifts).toEqual([{ startsAt: "10:00", endsAt: "14:00" }]);
    expect(column(added[2]!).shifts).toEqual([{ startsAt: "12:00", endsAt: "16:00" }]);
    expect(column(added[1]!).timeOff).toEqual([
      {
        startsAt: new Date(at(DAY, "14:00")).toISOString(),
        endsAt: new Date(at(DAY, "15:00")).toISOString(),
      },
    ]);
    expect(column(added[0]!).timeOff).toEqual([]);
    expect(column(secondHistorical).bookable).toBe(false);
    expect(column(C.doctor.memberId).shifts).toEqual([
      { startsAt: "08:00", endsAt: "20:00" },
      { startsAt: "20:00", endsAt: "24:00" },
    ]);
    for (const a of many.day.appointments) {
      expect(a.providerName).toBe(column(a.providerMembershipId).fullName);
    }
  });
});

describe("the day's bounds when the clock skips midnight (ADR-0026 A3)", () => {
  /** An appointment of the doctor on branch D at an instant, written as the owner. */
  async function storedAt(startsAt: string): Promise<string> {
    const id = randomUUID();
    await h.owner`INSERT INTO appointments (clinic_id, id, branch_id, patient_id, provider_membership_id,
                    service_id, starts_at, ends_at, status, overbooked, created_by, created_at, updated_at)
                  VALUES (${C.clinicId}, ${id}, ${C.branchD}, ${patient}, ${C.doctor.memberId}, null,
                    ${startsAt}::timestamptz, ${startsAt}::timestamptz + interval '20 minutes',
                    'booked', false, ${C.admin.userId}, now(), now())`;
    return id;
  }
  const ids = async (timezone: string, date: string) =>
    (await readCounted(timezone, date)).day.appointments.map((a) => a.id);

  it("Cairo 01:10 on the spring day belongs to that day, not to the day before", async () => {
    const id = await storedAt("2027-04-29T22:10:00.000Z"); // 2027-04-30 01:10 in Cairo
    expect(await ids("Africa/Cairo", "2027-04-30")).toContain(id);
    expect(await ids("Africa/Cairo", "2027-04-29")).not.toContain(id);
  });

  it("Havana 23:10 before the spring change belongs to the day before, not to the spring day", async () => {
    const id = await storedAt("2027-03-14T04:10:00.000Z"); // 2027-03-13 23:10 in Havana
    expect(await ids("America/Havana", "2027-03-13")).toContain(id);
    expect(await ids("America/Havana", "2027-03-14")).not.toContain(id);
  });
});
