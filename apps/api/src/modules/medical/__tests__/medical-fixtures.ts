import { randomUUID } from "node:crypto";

import type { Harness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { customRole, memberOn, setMaxUsers } from "../../identity/__tests__/user-fixtures.ts";
import type { AuthorizationInvalidator } from "../../identity/index.ts";
import {
  addPatient,
  at,
  book,
  bookingBody,
  bookingClinic,
  SUNDAY,
} from "../../appointments/__tests__/appointment-fixtures.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { icd10LoadScript } from "../../../cli/icd10-load-script.ts";
import { parseIcd10OrderFile } from "../index.ts";

// Spec §2: the visits and medical keys of the default doctor role (system-roles.ts, 0050), for custom
// roles that act as a second doctor.
export const DOCTOR_KEYS = [
  "view:visits:own",
  "create:visits:own",
  "view:medical:own",
  "update:medical:own",
] as const;

/** The platform's flag for one module of this clinic (upserted), then the cache. */
export async function setModule(
  h: Harness,
  invalidate: AuthorizationInvalidator,
  clinicId: string,
  module: "appointments" | "medical",
  enabled: boolean,
): Promise<void> {
  await h.owner`INSERT INTO clinic_features (clinic_id, id, module, enabled, updated_at)
                VALUES (${clinicId}, ${randomUUID()}, ${module}, ${enabled}, now())
                ON CONFLICT (clinic_id, module) DO UPDATE SET enabled = ${enabled}, updated_at = now()`;
  await invalidate.clinicChanged(clinicId);
}

/** Adds keys to an existing role (written as the owner, like `customRole`). */
export async function grantKeys(
  h: Harness,
  clinicId: string,
  roleId: string,
  keys: readonly string[],
): Promise<void> {
  for (const key of keys) {
    await h.owner`INSERT INTO role_permissions (clinic_id, id, role_id, permission_id, created_at)
                  SELECT ${clinicId}, ${randomUUID()}, ${roleId}, p.id, now() FROM permissions p
                  WHERE p.key = ${key}
                  ON CONFLICT DO NOTHING`;
  }
}

/** The role a member holds. */
export const roleOf = async (h: Harness, membershipId: string) => {
  const [row] = await h.owner`SELECT role_id FROM memberships WHERE id = ${membershipId}`;
  return row!["role_id"] as string;
};

/**
 * The booking clinic with the medical module on: the doctor (branch D) holds the doctor keys; doctor B, a
 * second bookable provider on branch D, too; the front desk (branch R) holds `view:visits:branch`; a
 * reader on every branch holds `view:visits:clinic` without any medical key. The admin holds none of the
 * module's keys (R1-4).
 */
export async function medicalClinic(h: Harness, invalidate: AuthorizationInvalidator) {
  const C = await bookingClinic(h, invalidate);
  await setMaxUsers(h, C.clinicId, 50);
  await setModule(h, invalidate, C.clinicId, "medical", true);
  // The doctor's system role holds its keys from the onboarding; the front desk is a custom role.
  await grantKeys(h, C.clinicId, await roleOf(h, C.front.memberId), ["view:visits:branch"]);
  const doctorB = await bookableMember(h, C, [...DOCTOR_KEYS, "view:appointments:own"]);
  const reader = await memberOn(
    h,
    C.admin,
    await customRole(h, C.clinicId, ["view:visits:clinic"]),
  );
  await invalidate.clinicChanged(C.clinicId);
  return { ...C, doctorB, reader };
}

export type MedicalClinic = Awaited<ReturnType<typeof medicalClinic>>;

/** A member of branch D holding `keys`, bookable there 08:00–20:00 every day. */
export async function bookableMember(
  h: Harness,
  C: { clinicId: string; branchD: string; admin: { clinicId: string; cookie: string } },
  keys: readonly string[],
) {
  const role = await customRole(h, C.clinicId, keys);
  const member = await memberOn(h, C.admin, role, { allBranches: false, branchIds: [C.branchD] });
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
  return member;
}

/**
 * An appointment booked by the admin on branch D (the doctor by default), then marked `arrived` unless
 * `arrived` is false.
 *
 * @returns the appointment's id
 */
export async function appointmentFor(
  h: Harness,
  C: MedicalClinic,
  patientId: string,
  time: string,
  o: { providerMembershipId?: string; arrived?: boolean; date?: string } = {},
): Promise<string> {
  const body = bookingBody(C, patientId, at(o.date ?? SUNDAY, time), {
    providerMembershipId: o.providerMembershipId ?? C.doctor.memberId,
  });
  const res = await book(h, C.admin.cookie, body);
  if (res.statusCode !== 201) throw new Error(`book ${res.statusCode} ${res.body}`);
  const id = (res.json() as { appointment: { id: string } }).appointment.id;
  if (o.arrived === false) return id;
  const arrived = await send(h, C.admin.cookie, "POST", `/v1/appointments/${id}/status`, {
    status: "arrived",
  });
  if (arrived.statusCode !== 200) throw new Error(`arrive ${arrived.statusCode} ${arrived.body}`);
  return id;
}

/** POST /v1/visits as `cookie` with a fresh key (or the one given). */
export const startVisit = (h: Harness, cookie: string, body: unknown, key = randomUUID()) =>
  send(h, cookie, "POST", "/v1/visits", body, key);

/** A started visit's id (the call must succeed). */
export async function startedVisit(h: Harness, cookie: string, body: unknown): Promise<string> {
  const res = await startVisit(h, cookie, body);
  if (res.statusCode !== 201) throw new Error(`start ${res.statusCode} ${res.body}`);
  return (res.json() as { visit: { visit: { id: string } } }).visit.visit.id;
}

/** A new active file registered in `branchId`. */
export const patientIn = (h: Harness, C: { clinicId: string }, branchId: string) =>
  addPatient(h, C.clinicId, branchId);

/** Every audit row of the clinic written after `since`, oldest first, with its JSON as text. */
export const medicalAudit = (h: Harness, clinicId: string, since: Date) =>
  h.owner`SELECT action, category, entity_type, entity_id, branch_id, details,
            row_to_json(a)::text AS raw
          FROM audit_log a WHERE clinic_id = ${clinicId} AND created_at >= ${since}
          ORDER BY created_at, id`;

/** One line of the CDC order file's fixed-width layout (R2-8). */
const orderLine = (order: number, code: string, billable: boolean, title: string) =>
  `${String(order).padStart(5, "0")} ${code.padEnd(7)} ${billable ? 1 : 0} ${title.slice(0, 60).padEnd(60)} ${title}`;

/** ICD-10-CM codes the medical specs search and diagnose with: a header row, real codes, 25 fillers. */
export const ICD10_SAMPLE = [
  orderLine(1, "F41", false, "Other anxiety disorders"),
  orderLine(2, "F410", true, "Panic disorder [episodic paroxysmal anxiety]"),
  orderLine(3, "F411", true, "Generalized anxiety disorder"),
  orderLine(4, "F419", true, "Anxiety disorder, unspecified"),
  orderLine(5, "I10", true, "Essential (primary) hypertension"),
  ...Array.from({ length: 25 }, (_, i) =>
    orderLine(10 + i, `U99${String(i).padStart(2, "0")}`, true, `Eyadexfiller condition ${i}`),
  ),
].join("\n");

/**
 * Loads `ICD10_SAMPLE` through the loader's own script, as the owner (the runtime role only reads
 * `icd10_codes`). The table is global and the database shared, so the upsert makes reruns harmless.
 */
export async function seedIcd10(h: Harness): Promise<void> {
  // The script carries its own BEGIN/COMMIT, which postgres.js runs only on one reserved connection.
  const connection = await h.owner.reserve();
  try {
    await connection.unsafe(icd10LoadScript(parseIcd10OrderFile(ICD10_SAMPLE))).simple();
  } finally {
    connection.release();
  }
}
