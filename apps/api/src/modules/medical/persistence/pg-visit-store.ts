import type { VisitStatus } from "@eyadex/contracts/visits";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** صف زيارة زي ما اتخزّن (0046). ملاحظة الإلغاء ظرف مشفّر، عمرها ما تبقى نص. */
export interface VisitRow {
  readonly id: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly providerMembershipId: string;
  readonly appointmentId: string | null;
  readonly status: VisitStatus;
  readonly startedAt: string;
  readonly signedAt: string | null;
  readonly cancelNoteEnc: string | null;
}

interface Raw {
  id: string;
  branch_id: string;
  patient_id: string;
  provider_membership_id: string;
  appointment_id: string | null;
  status: VisitStatus;
  started_at: string;
  signed_at: string | null;
  cancel_note_enc: string | null;
}

// ISO text straight from PostgreSQL: a Date would drop the microseconds a cursor compares on.
export const VISIT_COLUMNS = sql`v.id, v.branch_id, v.patient_id, v.provider_membership_id,
  v.appointment_id, v.status,
  to_char(v.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at,
  to_char(v.signed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS signed_at,
  v.cancel_note_enc`;

/**
 * A raw visit row as typed by the store.
 *
 * @param r the row
 * @returns the visit
 */
export const toVisitRow = (r: Raw): VisitRow => ({
  id: r.id,
  branchId: r.branch_id,
  patientId: r.patient_id,
  providerMembershipId: r.provider_membership_id,
  appointmentId: r.appointment_id,
  status: r.status,
  startedAt: r.started_at,
  signedAt: r.signed_at,
  cancelNoteEnc: r.cancel_note_enc,
});

export type RawVisit = Raw;

/**
 * One visit, `FOR UPDATE` when `lock` (after its provider's lock, ADR-0027).
 *
 * @returns the visit, or `null` when it is not one of this clinic's
 */
export async function findVisit(
  tx: Tx,
  clinicId: string,
  id: string,
  lock = false,
): Promise<VisitRow | null> {
  const rows = await tx.execute<Raw>(
    sql`SELECT ${VISIT_COLUMNS} FROM visits v WHERE v.clinic_id = ${clinicId} AND v.id = ${id}
        ${lock ? sql`FOR UPDATE` : sql``}`,
  );
  return rows[0] === undefined ? null : toVisitRow(rows[0]);
}

/**
 * The live (not cancelled) visit of an appointment, read under the provider's lock.
 *
 * @returns its id, or `null`
 */
export async function liveVisitOf(
  tx: Tx,
  clinicId: string,
  appointmentId: string,
): Promise<string | null> {
  const rows = await tx.execute<{ id: string }>(
    sql`SELECT id FROM visits WHERE clinic_id = ${clinicId} AND appointment_id = ${appointmentId}
          AND status <> 'cancelled'`,
  );
  return rows[0]?.id ?? null;
}

/** A new draft visit. */
export interface NewVisit {
  readonly id: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly providerMembershipId: string;
  readonly appointmentId: string | null;
}

export async function insertVisit(
  tx: Tx,
  clinicId: string,
  visit: NewVisit,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`INSERT INTO visits (clinic_id, id, branch_id, patient_id, provider_membership_id,
          appointment_id, status, started_at, created_at, updated_at)
        VALUES (${clinicId}, ${visit.id}, ${visit.branchId}, ${visit.patientId},
          ${visit.providerMembershipId}, ${visit.appointmentId}, 'draft', ${at}::timestamptz,
          ${at}::timestamptz, ${at}::timestamptz)`,
  );
}

export async function markSigned(
  tx: Tx,
  clinicId: string,
  id: string,
  signedBy: string,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`UPDATE visits SET status = 'signed', signed_at = ${at}::timestamptz, signed_by = ${signedBy},
          updated_at = ${at}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${id}`,
  );
}

export async function markCancelled(
  tx: Tx,
  clinicId: string,
  id: string,
  cancel: { readonly reason: string; readonly noteEnc: string | null },
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`UPDATE visits SET status = 'cancelled', cancel_reason = ${cancel.reason},
          cancel_note_enc = ${cancel.noteEnc}, updated_at = ${at}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${id}`,
  );
}
