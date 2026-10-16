import type { AppointmentStatus } from "@eyadex/contracts/appointments";
import type { Tx } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";

/** An appointment as the billing module reads it to draft or issue an invoice. */
export interface BillingAppointmentRow {
  readonly patientId: string;
  readonly branchId: string;
  readonly providerId: string;
  readonly serviceId: string | null;
  readonly status: AppointmentStatus;
}

/**
 * The appointments module's adapter for the billing module's `BillingAppointmentReader` port (finance
 * R1-7): who, where, with whom, for which service and in which status; never the cancel note, so billing
 * never names the appointments table.
 */
export class PgBillingAppointments {
  find(tx: Tx, clinicId: string, appointmentId: string): Promise<BillingAppointmentRow | null> {
    return readAppointment(tx, clinicId, appointmentId, sql``);
  }

  // A cancel or a move holds this row FOR UPDATE, so an issue waits for it and reads what it wrote.
  lockForInvoice(
    tx: Tx,
    clinicId: string,
    appointmentId: string,
  ): Promise<BillingAppointmentRow | null> {
    return readAppointment(tx, clinicId, appointmentId, sql` FOR UPDATE`);
  }
}

async function readAppointment(
  tx: Tx,
  clinicId: string,
  appointmentId: string,
  lock: SQL,
): Promise<BillingAppointmentRow | null> {
  const [row] = await tx.execute<{
    patient_id: string;
    branch_id: string;
    provider_membership_id: string;
    service_id: string | null;
    status: AppointmentStatus;
  }>(
    sql`SELECT patient_id, branch_id, provider_membership_id, service_id, status FROM appointments
        WHERE clinic_id = ${clinicId} AND id = ${appointmentId}${lock}`,
  );
  return row === undefined
    ? null
    : {
        patientId: row.patient_id,
        branchId: row.branch_id,
        providerId: row.provider_membership_id,
        serviceId: row.service_id,
        status: row.status,
      };
}
