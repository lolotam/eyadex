import type { WallShift } from "@eyadex/contracts/schedules";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { wallFromDb, type ScheduleRow } from "../domain/schedule-rules.ts";
import type { TimeOffRecord } from "../domain/time-off-rules.ts";

// SQL on provider_schedules and provider_time_off (0042). Every function runs inside the caller's
// withTenant(clinicId), under the provider lock when it writes.

export async function readScheduleRows(
  tx: Tx,
  clinicId: string,
  membershipId: string,
): Promise<ScheduleRow[]> {
  const rows = await tx.execute<{
    id: string;
    branch_id: string;
    weekday: number;
    starts_at: string;
    ends_at: string;
  }>(
    sql`SELECT id, branch_id, weekday, starts_at::text AS starts_at, ends_at::text AS ends_at
        FROM provider_schedules WHERE clinic_id = ${clinicId} AND membership_id = ${membershipId}
        ORDER BY weekday, starts_at`,
  );
  return rows.map((r) => ({
    id: r.id,
    branchId: r.branch_id,
    weekday: Number(r.weekday),
    startsAt: wallFromDb(r.starts_at),
    endsAt: wallFromDb(r.ends_at),
  }));
}

const idArray = (ids: readonly string[]) => sql`string_to_array(${ids.join(",")}, ',')::uuid[]`;

/** Appends to the list under `key`, so one bulk read groups back into per-provider lists. */
function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/**
 * The branch day's columns in one statement (not one per provider): each provider's rows of this
 * branch on this weekday, as wall times, earliest first. A provider without rows there is absent.
 */
export async function readBranchDayShifts(
  tx: Tx,
  clinicId: string,
  membershipIds: readonly string[],
  branchId: string,
  weekday: number,
): Promise<Map<string, { startsAt: string; endsAt: string }[]>> {
  const shifts = new Map<string, { startsAt: string; endsAt: string }[]>();
  if (membershipIds.length === 0) return shifts;
  const rows = await tx.execute<{ membership_id: string; starts_at: string; ends_at: string }>(
    sql`SELECT membership_id, starts_at::text AS starts_at, ends_at::text AS ends_at
        FROM provider_schedules
        WHERE clinic_id = ${clinicId} AND membership_id = ANY(${idArray(membershipIds)})
          AND branch_id = ${branchId} AND weekday = ${weekday}
        ORDER BY membership_id, starts_at, id`,
  );
  for (const r of rows) {
    push(shifts, r.membership_id, {
      startsAt: wallFromDb(r.starts_at),
      endsAt: wallFromDb(r.ends_at),
    });
  }
  return shifts;
}

/** The branches still holding this provider's rows, live or dormant. */
export async function readHeldBranchIds(
  tx: Tx,
  clinicId: string,
  membershipId: string,
): Promise<string[]> {
  const rows = await tx.execute<{ branch_id: string }>(
    sql`SELECT DISTINCT branch_id FROM provider_schedules
        WHERE clinic_id = ${clinicId} AND membership_id = ${membershipId}`,
  );
  return rows.map((r) => r.branch_id);
}

/** Every provider of the clinic with the branches holding its rows (one query for the list). */
export async function readHeldBranchesByProvider(
  tx: Tx,
  clinicId: string,
): Promise<Map<string, string[]>> {
  const rows = await tx.execute<{ membership_id: string; branch_id: string }>(
    sql`SELECT DISTINCT membership_id, branch_id FROM provider_schedules WHERE clinic_id = ${clinicId}`,
  );
  const held = new Map<string, string[]>();
  for (const r of rows)
    held.set(r.membership_id, [...(held.get(r.membership_id) ?? []), r.branch_id]);
  return held;
}

/** The branch's week is configuration: its rows are replaced, never edited (ADR-0026 §4). */
export async function replaceBranchRows(
  tx: Tx,
  clinicId: string,
  membershipId: string,
  branchId: string,
  shifts: readonly WallShift[],
  newId: () => string,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`DELETE FROM provider_schedules WHERE clinic_id = ${clinicId}
          AND membership_id = ${membershipId} AND branch_id = ${branchId}`,
  );
  for (const s of shifts) {
    await tx.execute(
      sql`INSERT INTO provider_schedules (clinic_id, id, membership_id, branch_id, weekday,
            starts_at, ends_at, created_at)
          VALUES (${clinicId}, ${newId()}, ${membershipId}, ${branchId}, ${s.weekday},
            ${s.startsAt}::time, ${s.endsAt}::time, ${now.toISOString()}::timestamptz)`,
    );
  }
}

interface TimeOffRow {
  id: string;
  starts_at: Date | string;
  ends_at: Date | string;
  note: string | null;
  cancelled_at: Date | string | null;
}

const toTimeOff = (r: TimeOffRow): TimeOffRecord => ({
  id: r.id,
  startsAt: new Date(r.starts_at),
  endsAt: new Date(r.ends_at),
  note: r.note,
  cancelledAt: r.cancelled_at === null ? null : new Date(r.cancelled_at),
});

export async function insertTimeOff(
  tx: Tx,
  clinicId: string,
  membershipId: string,
  record: TimeOffRecord,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`INSERT INTO provider_time_off (clinic_id, id, membership_id, starts_at, ends_at, note,
          cancelled_at, created_at, updated_at)
        VALUES (${clinicId}, ${record.id}, ${membershipId}, ${record.startsAt.toISOString()}::timestamptz,
          ${record.endsAt.toISOString()}::timestamptz, ${record.note}, NULL, ${at}::timestamptz,
          ${at}::timestamptz)`,
  );
}

/** One time off of this provider, row-locked; `null` = not this provider's in this clinic. */
export async function findTimeOff(
  tx: Tx,
  clinicId: string,
  membershipId: string,
  id: string,
): Promise<TimeOffRecord | null> {
  const rows = await tx.execute<TimeOffRow>(
    sql`SELECT id, starts_at, ends_at, note, cancelled_at FROM provider_time_off
        WHERE clinic_id = ${clinicId} AND membership_id = ${membershipId} AND id = ${id} FOR UPDATE`,
  );
  return rows[0] === undefined ? null : toTimeOff(rows[0]);
}

export async function markTimeOffCancelled(
  tx: Tx,
  clinicId: string,
  id: string,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`UPDATE provider_time_off SET cancelled_at = ${at}::timestamptz, updated_at = ${at}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${id}`,
  );
}

/** Time off that is not cancelled and has not ended, earliest first. */
export async function readUpcomingTimeOff(
  tx: Tx,
  clinicId: string,
  membershipId: string,
  now: Date,
): Promise<TimeOffRecord[]> {
  const rows = await tx.execute<TimeOffRow>(
    sql`SELECT id, starts_at, ends_at, note, cancelled_at FROM provider_time_off
        WHERE clinic_id = ${clinicId} AND membership_id = ${membershipId}
          AND cancelled_at IS NULL AND ends_at > ${now.toISOString()}::timestamptz
        ORDER BY starts_at, id`,
  );
  return rows.map(toTimeOff);
}

/** Rule 2: the provider's time off that is not cancelled and shares a minute with the span. */
export async function readTimeOffOverlapping(
  tx: Tx,
  clinicId: string,
  membershipId: string,
  span: { readonly startsAt: string; readonly endsAt: string },
): Promise<{ startsAt: string; endsAt: string }[]> {
  const rows = await tx.execute<TimeOffRow>(
    sql`SELECT id, starts_at, ends_at, note, cancelled_at FROM provider_time_off
        WHERE clinic_id = ${clinicId} AND membership_id = ${membershipId} AND cancelled_at IS NULL
          AND starts_at < ${span.endsAt}::timestamptz AND ends_at > ${span.startsAt}::timestamptz
        ORDER BY starts_at, id`,
  );
  return rows.map((r) => ({
    startsAt: new Date(r.starts_at).toISOString(),
    endsAt: new Date(r.ends_at).toISOString(),
  }));
}

/** Rule 2 for many providers in one statement (the branch day): each one's overlapping time off. */
export async function readTimeOffOverlappingFor(
  tx: Tx,
  clinicId: string,
  membershipIds: readonly string[],
  span: { readonly startsAt: string; readonly endsAt: string },
): Promise<Map<string, { startsAt: string; endsAt: string }[]>> {
  const timeOff = new Map<string, { startsAt: string; endsAt: string }[]>();
  if (membershipIds.length === 0) return timeOff;
  const rows = await tx.execute<{
    membership_id: string;
    starts_at: Date | string;
    ends_at: Date | string;
  }>(
    sql`SELECT membership_id, starts_at, ends_at FROM provider_time_off
        WHERE clinic_id = ${clinicId} AND membership_id = ANY(${idArray(membershipIds)})
          AND cancelled_at IS NULL
          AND starts_at < ${span.endsAt}::timestamptz AND ends_at > ${span.startsAt}::timestamptz
        ORDER BY starts_at, id`,
  );
  for (const r of rows) {
    push(timeOff, r.membership_id, {
      startsAt: new Date(r.starts_at).toISOString(),
      endsAt: new Date(r.ends_at).toISOString(),
    });
  }
  return timeOff;
}
