import type { TimeSpan } from "@eyadex/contracts/appointment-slots";
import type { AppointmentStatus, CancelReason } from "@eyadex/contracts/appointments";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

// SQL on appointments (0043) and the service rows a booking reads. Every function runs inside the
// caller's withTenant(clinicId), under the provider lock when it writes (ADR-0026 §3, ADR-0027), and
// filters on clinic_id itself on top of RLS.

/** One appointment as stored (instants as ISO strings, UTC). */
export interface AppointmentRow {
  readonly id: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly providerMembershipId: string;
  readonly serviceId: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: AppointmentStatus;
  readonly overbooked: boolean;
  readonly cancelReason: CancelReason | null;
  readonly cancelNote: string | null;
}

interface Raw {
  id: string;
  branch_id: string;
  patient_id: string;
  provider_membership_id: string;
  service_id: string | null;
  starts_at: Date | string;
  ends_at: Date | string;
  status: AppointmentStatus;
  overbooked: boolean;
  cancel_reason: CancelReason | null;
  cancel_note: string | null;
}

const COLUMNS = sql`id, branch_id, patient_id, provider_membership_id, service_id, starts_at, ends_at,
  status, overbooked, cancel_reason, cancel_note`;

const iso = (value: Date | string): string => new Date(value).toISOString();

const toRow = (r: Raw): AppointmentRow => ({
  id: r.id,
  branchId: r.branch_id,
  patientId: r.patient_id,
  providerMembershipId: r.provider_membership_id,
  serviceId: r.service_id,
  startsAt: iso(r.starts_at),
  endsAt: iso(r.ends_at),
  status: r.status,
  overbooked: r.overbooked,
  cancelReason: r.cancel_reason,
  cancelNote: r.cancel_note,
});

/** One appointment of this clinic, `FOR UPDATE` when the caller is about to change it; `null` = unknown. */
export async function findAppointment(
  tx: Tx,
  clinicId: string,
  id: string,
  forUpdate = false,
): Promise<AppointmentRow | null> {
  const lock = forUpdate ? sql` FOR UPDATE` : sql``;
  const rows = await tx.execute<Raw>(
    sql`SELECT ${COLUMNS} FROM appointments WHERE clinic_id = ${clinicId} AND id = ${id}${lock}`,
  );
  return rows[0] === undefined ? null : toRow(rows[0]);
}

export async function insertAppointment(
  tx: Tx,
  clinicId: string,
  row: AppointmentRow,
  createdBy: string,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`INSERT INTO appointments (clinic_id, id, branch_id, patient_id, provider_membership_id,
          service_id, starts_at, ends_at, status, overbooked, cancel_reason, cancel_note, created_by,
          created_at, updated_at)
        VALUES (${clinicId}, ${row.id}, ${row.branchId}, ${row.patientId}, ${row.providerMembershipId},
          ${row.serviceId}, ${row.startsAt}::timestamptz, ${row.endsAt}::timestamptz, ${row.status},
          ${row.overbooked}, ${row.cancelReason}, ${row.cancelNote}, ${createdBy},
          ${at}::timestamptz, ${at}::timestamptz)`,
  );
}

/** Rule 2: the provider's live appointments sharing a minute with [from, to), except one. */
export async function providerBusy(
  tx: Tx,
  clinicId: string,
  membershipId: string,
  span: TimeSpan,
  exceptId: string | null,
): Promise<TimeSpan[]> {
  const except = exceptId === null ? sql`` : sql` AND id <> ${exceptId}`;
  const rows = await tx.execute<{ starts_at: Date | string; ends_at: Date | string }>(
    sql`SELECT starts_at, ends_at FROM appointments
        WHERE clinic_id = ${clinicId} AND provider_membership_id = ${membershipId}
          AND status <> 'cancelled'
          AND starts_at < ${span.endsAt}::timestamptz AND ends_at > ${span.startsAt}::timestamptz${except}`,
  );
  return rows.map((r) => ({ startsAt: iso(r.starts_at), endsAt: iso(r.ends_at) }));
}

/** A reschedule (rule 6): the new time, provider and branch, and the recomputed overbook mark. */
export async function saveTimes(
  tx: Tx,
  clinicId: string,
  row: Pick<
    AppointmentRow,
    "id" | "branchId" | "providerMembershipId" | "startsAt" | "endsAt" | "overbooked"
  >,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE appointments SET branch_id = ${row.branchId},
          provider_membership_id = ${row.providerMembershipId},
          starts_at = ${row.startsAt}::timestamptz, ends_at = ${row.endsAt}::timestamptz,
          overbooked = ${row.overbooked}, updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${row.id}`,
  );
}

/** A status move (D-5); a cancel also records its reason and note (D-11). */
export async function saveStatus(
  tx: Tx,
  clinicId: string,
  id: string,
  change: {
    status: AppointmentStatus;
    cancelReason: CancelReason | null;
    cancelNote: string | null;
  },
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE appointments SET status = ${change.status}, cancel_reason = ${change.cancelReason},
          cancel_note = ${change.cancelNote}, updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${id}`,
  );
}

/** The branch's live appointments that share a minute with the day [from, to), earliest first. */
export async function branchDayRows(
  tx: Tx,
  clinicId: string,
  branchId: string,
  day: TimeSpan,
): Promise<AppointmentRow[]> {
  const rows = await tx.execute<Raw>(
    sql`SELECT ${COLUMNS} FROM appointments
        WHERE clinic_id = ${clinicId} AND branch_id = ${branchId} AND status <> 'cancelled'
          AND starts_at < ${day.endsAt}::timestamptz AND ends_at > ${day.startsAt}::timestamptz
        ORDER BY starts_at, id`,
  );
  return rows.map(toRow);
}

/** One provider's live appointments in one branch touching a span (the A4 week), earliest first. */
export async function providerSpanRows(
  tx: Tx,
  clinicId: string,
  branchId: string,
  providerMembershipId: string,
  span: TimeSpan,
): Promise<AppointmentRow[]> {
  const rows = await tx.execute<Raw>(
    sql`SELECT ${COLUMNS} FROM appointments
        WHERE clinic_id = ${clinicId} AND provider_membership_id = ${providerMembershipId}
          AND branch_id = ${branchId} AND status <> 'cancelled'
          AND starts_at < ${span.endsAt}::timestamptz AND ends_at > ${span.startsAt}::timestamptz
        ORDER BY starts_at, id`,
  );
  return rows.map(toRow);
}

/**
 * Live appointments of one branch starting inside a span, counted per clinic-calendar date (the A4
 * month); `providerMembershipId: null` counts every provider. Days without one are absent.
 */
export async function branchStartCounts(
  tx: Tx,
  clinicId: string,
  branchId: string,
  providerMembershipId: string | null,
  span: TimeSpan,
  timezone: string,
): Promise<Map<string, number>> {
  const provider =
    providerMembershipId === null
      ? sql``
      : sql`AND provider_membership_id = ${providerMembershipId}`;
  const rows = await tx.execute<{ date: string; count: number | string }>(
    sql`SELECT to_char(starts_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS date, count(*) AS count
        FROM appointments
        WHERE clinic_id = ${clinicId} AND branch_id = ${branchId} AND status <> 'cancelled' ${provider}
          AND starts_at >= ${span.startsAt}::timestamptz AND starts_at < ${span.endsAt}::timestamptz
        GROUP BY 1`,
  );
  return new Map(rows.map((r) => [r.date, Number(r.count)]));
}

/** A service as a booking reads it. */
export interface BookingService {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly durationMinutes: number;
  readonly active: boolean;
}

interface ServiceRaw {
  id: string;
  name_ar: string;
  name_en: string;
  duration_minutes: number;
  status: "active" | "inactive";
}

const toService = (r: ServiceRaw): BookingService => ({
  id: r.id,
  nameAr: r.name_ar,
  nameEn: r.name_en,
  durationMinutes: Number(r.duration_minutes),
  active: r.status === "active",
});

/** The service row `FOR SHARE` (ADR-0027: last of the rows a booking locks); `null` = unknown. */
export async function lockService(
  tx: Tx,
  clinicId: string,
  id: string,
): Promise<BookingService | null> {
  const rows = await tx.execute<ServiceRaw>(
    sql`SELECT id, name_ar, name_en, duration_minutes, status FROM clinic_services
        WHERE clinic_id = ${clinicId} AND id = ${id} FOR SHARE`,
  );
  return rows[0] === undefined ? null : toService(rows[0]);
}

/** Services by id, for the appointment view and the audit snapshot. */
export async function servicesOf(
  tx: Tx,
  clinicId: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, BookingService>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx.execute<ServiceRaw>(
    sql`SELECT id, name_ar, name_en, duration_minutes, status FROM clinic_services
        WHERE clinic_id = ${clinicId}
          AND id = ANY(string_to_array(${unique.join(",")}, ',')::uuid[])`,
  );
  return new Map(rows.map((r) => [r.id, toService(r)]));
}
