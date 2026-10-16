import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** A visit as the billing module reads it: its service comes from its appointment, if it has one. */
export interface BillingVisitRow {
  readonly patientId: string;
  readonly branchId: string;
  readonly providerId: string;
  readonly appointmentId: string | null;
}

/**
 * The medical module's adapter for the billing module's `BillingVisitReader` port (finance R1-7): the
 * visit's facts and the visits made from an appointment, never a note, a diagnosis or anything clinical.
 */
export class PgBillingVisits {
  async find(tx: Tx, clinicId: string, visitId: string): Promise<BillingVisitRow | null> {
    const [row] = await tx.execute<{
      patient_id: string;
      branch_id: string;
      provider_membership_id: string;
      appointment_id: string | null;
    }>(
      sql`SELECT patient_id, branch_id, provider_membership_id, appointment_id FROM visits
          WHERE clinic_id = ${clinicId} AND id = ${visitId}`,
    );
    return row === undefined
      ? null
      : {
          patientId: row.patient_id,
          branchId: row.branch_id,
          providerId: row.provider_membership_id,
          appointmentId: row.appointment_id,
        };
  }
  async idsForAppointment(tx: Tx, clinicId: string, appointmentId: string): Promise<string[]> {
    const rows = await tx.execute<{ id: string }>(
      sql`SELECT id FROM visits WHERE clinic_id = ${clinicId} AND appointment_id = ${appointmentId}`,
    );
    return rows.map((r) => r.id);
  }
}
