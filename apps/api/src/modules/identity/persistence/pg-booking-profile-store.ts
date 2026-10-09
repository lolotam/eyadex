import type { BookingProfile, BookingProfileInput } from "@eyadex/contracts/services";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

// SQL of the booking profile (0042's two membership columns). Runs inside the caller's withTenant.

/** The member's booking profile; `null` = no such member in this clinic. */
export async function readBookingProfile(
  tx: Tx,
  clinicId: string,
  memberId: string,
): Promise<BookingProfile | null> {
  const rows = await tx.execute<{
    id: string;
    accepts_appointments: boolean;
    default_duration_minutes: number;
  }>(
    sql`SELECT id, accepts_appointments, default_duration_minutes FROM memberships
        WHERE clinic_id = ${clinicId} AND id = ${memberId}`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    memberId: row.id,
    acceptsAppointments: row.accepts_appointments,
    defaultDurationMinutes: Number(row.default_duration_minutes),
  };
}

export async function saveBookingProfile(
  tx: Tx,
  clinicId: string,
  memberId: string,
  input: BookingProfileInput,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE memberships SET accepts_appointments = ${input.acceptsAppointments},
          default_duration_minutes = ${input.defaultDurationMinutes},
          updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${memberId}`,
  );
}
