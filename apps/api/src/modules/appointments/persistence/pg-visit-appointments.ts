import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** An appointment as the medical module reads it to start a visit (its `MedicalAppointmentReader`). */
export interface VisitAppointmentRow {
  readonly id: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly providerMembershipId: string;
  readonly status: string;
}

interface Raw {
  id: string;
  branch_id: string;
  patient_id: string;
  provider_membership_id: string;
  status: string;
}

const toRow = (r: Raw): VisitAppointmentRow => ({
  id: r.id,
  branchId: r.branch_id,
  patientId: r.patient_id,
  providerMembershipId: r.provider_membership_id,
  status: r.status,
});

/**
 * The appointments module's adapter for the medical module's `MedicalAppointmentReader` port (ADR-0029):
 * the facts a visit needs, never the cancel note, so the medical module never names the appointments
 * table.
 */
export class PgVisitAppointments {
  async find(tx: Tx, clinicId: string, appointmentId: string): Promise<VisitAppointmentRow | null> {
    const rows = await tx.execute<Raw>(
      sql`SELECT id, branch_id, patient_id, provider_membership_id, status FROM appointments
          WHERE clinic_id = ${clinicId} AND id = ${appointmentId}`,
    );
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  // ADR-0027: an appointments row right after the provider locks, before the membership row. A status
  // change takes the same provider lock first, so FOR SHARE only guards writers that skip it.
  async lockForVisit(
    tx: Tx,
    clinicId: string,
    appointmentId: string,
  ): Promise<VisitAppointmentRow | null> {
    const rows = await tx.execute<Raw>(
      sql`SELECT id, branch_id, patient_id, provider_membership_id, status FROM appointments
          WHERE clinic_id = ${clinicId} AND id = ${appointmentId} FOR SHARE`,
    );
    return rows[0] === undefined ? null : toRow(rows[0]);
  }
}
