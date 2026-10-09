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
