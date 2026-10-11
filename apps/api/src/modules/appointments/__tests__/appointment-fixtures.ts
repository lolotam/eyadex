import { randomUUID } from "node:crypto";

import { wallToInstant } from "@eyadex/contracts/clinic-time";

import type { Harness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import type { AuthorizationInvalidator } from "../../identity/index.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import { fakePhone } from "../../patients/__tests__/patient-fixtures.ts";
import { schedulingClinic, send } from "./scheduling-fixtures.ts";

// Slice A2 (ADR-0026 §11). The fixture clinic's zone is Asia/Kuwait (UTC+3, no daylight saving).
export const TZ = "Asia/Kuwait";
// 2027-03-07 is a Sunday (weekday 0); the next days follow.
export const SUNDAY = "2027-03-07";
export const MONDAY = "2027-03-08";
export const TUESDAY = "2027-03-09";
export const WEDNESDAY = "2027-03-10";
export const at = (date: string, time: string) => wallToInstant(date, time, TZ);

/** A file written as the owner (the patients slice has its own create tests). */
export async function addPatient(
  h: Harness,
  clinicId: string,
  branchId: string,
  status: "active" | "archived" = "active",
): Promise<string> {
  const id = randomUUID();
  await h.owner`INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender,
                  registration_branch_id, status, created_at, updated_at)
                VALUES (${clinicId}, ${id}, ${String(Math.floor(Math.random() * 1e9))},
                  ${`Booked Patient ${id.slice(0, 4)}`}, ${`+965${fakePhone()}`}, '1990-04-01',
                  'female', ${branchId}, ${status}, now(), now())`;
  return id;
}

const everyDay = (from: string, to: string) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startsAt: from, endsAt: to }));

/**
 * The scheduling clinic plus: the doctor bookable on branch D every day 08:00–20:00 and Sunday night
 * 20:00–24:00 + Monday 00:00–01:00 (D-14); the admin bookable on branch R every day 08:00–20:00; a front
 * desk on branch R holding the new clinics' receptionist keys (no overbook); a service of 30 minutes.
 */
export async function bookingClinic(h: Harness, invalidate: AuthorizationInvalidator) {
  const C = await schedulingClinic(h, invalidate);
  const profile = { acceptsAppointments: true, defaultDurationMinutes: 20 };
  for (const memberId of [C.doctor.memberId, C.admin.memberId]) {
    const res = await send(
      h,
      C.admin.cookie,
      "PUT",
      `/v1/users/${memberId}/booking-profile`,
      profile,
    );
    if (res.statusCode !== 200) throw new Error(`booking profile ${res.statusCode}`);
  }
  const weeks: [string, string, unknown[]][] = [
    [
      C.doctor.memberId,
      C.branchD,
      [
        ...everyDay("08:00", "20:00"),
        { weekday: 0, startsAt: "20:00", endsAt: "24:00" },
        { weekday: 1, startsAt: "00:00", endsAt: "01:00" },
      ],
    ],
    [C.admin.memberId, C.branchR, everyDay("08:00", "20:00")],
  ];
  for (const [memberId, branchId, shifts] of weeks) {
    const res = await send(
      h,
      C.admin.cookie,
      "PUT",
      `/v1/schedules/${memberId}/branches/${branchId}`,
      {
        shifts,
      },
    );
    if (res.statusCode !== 200) throw new Error(`schedule ${res.statusCode} ${res.body}`);
  }
  const frontRole = await customRole(h, C.clinicId, [
    "view:patients:branch",
    "create:patients:branch",
    "update:patients:branch",
    "view:appointments:branch",
    "create:appointments:branch",
    "update:appointments:branch",
    "view:schedules:branch",
    "view:services:clinic",
  ]);
  const front = await memberOn(h, C.admin, frontRole, {
    allBranches: false,
    branchIds: [C.branchR],
  });
  const service = await send(
    h,
    C.admin.cookie,
    "POST",
    "/v1/services",
    {
      nameAr: `خدمة ${randomUUID().slice(0, 4)}`,
      nameEn: `Visit ${randomUUID().slice(0, 4)}`,
      durationMinutes: 30,
    },
    randomUUID(),
  );
  if (service.statusCode !== 201) throw new Error(`service ${service.statusCode}`);
  return { ...C, front, serviceId: (service.json() as { id: string }).id };
}

export type BookingClinic = Awaited<ReturnType<typeof bookingClinic>>;

/** A create body: the doctor on branch D, no service, the provider's default length. */
export const bookingBody = (
  C: BookingClinic,
  patientId: string,
  startsAt: string,
  extra: Record<string, unknown> = {},
) => ({
  branchId: C.branchD,
  providerMembershipId: C.doctor.memberId,
  patientId,
  serviceId: null,
  startsAt,
  endsAt: null,
  overbook: false,
  ...extra,
});

/** POST /v1/appointments as `cookie` with a fresh key (or the one given). */
export const book = (h: Harness, cookie: string, body: unknown, key: string = randomUUID()) =>
  send(h, cookie, "POST", "/v1/appointments", body, key);

export const appointmentAudit = (h: Harness, clinicId: string, appointmentId: string) =>
  h.owner`SELECT action, category, entity_type, details, details::text AS raw FROM audit_log
          WHERE clinic_id = ${clinicId} AND entity_id = ${appointmentId} ORDER BY created_at, id`;
