import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** A file as the appointments module reads it (its `BookingPatientReader` port, ADR-0026 §11). */
export interface BookingPatientRow {
  readonly id: string;
  readonly fullName: string;
  readonly fileNumber: number;
  readonly active: boolean;
}

interface Raw {
  id: string;
  full_name: string;
  file_number: string;
  status: "active" | "archived";
}

const toRow = (r: Raw): BookingPatientRow => ({
  id: r.id,
  fullName: r.full_name,
  fileNumber: Number(r.file_number),
  active: r.status === "active",
});

/**
 * The patients module's adapter for the appointments module's `BookingPatientReader` port: the name,
 * file number and status only — never the phone, birth date or civil ID — inside the appointments
 * transaction, so the appointments module never names the patients table.
 */
export class PgBookingPatients {
  // ADR-0027: a patient row after the membership row and before the branch row.
  async lockForBooking(
    tx: Tx,
    clinicId: string,
    patientId: string,
  ): Promise<BookingPatientRow | null> {
    const rows = await tx.execute<Raw>(
      sql`SELECT id, full_name, file_number, status FROM patients
          WHERE clinic_id = ${clinicId} AND id = ${patientId} FOR SHARE`,
    );
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  async labels(
    tx: Tx,
    clinicId: string,
    patientIds: readonly string[],
  ): Promise<ReadonlyMap<string, BookingPatientRow>> {
    const unique = [...new Set(patientIds)];
    if (unique.length === 0) return new Map();
    const rows = await tx.execute<Raw>(
      sql`SELECT id, full_name, file_number, status FROM patients WHERE clinic_id = ${clinicId}
          AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(unique)}::jsonb))`,
    );
    return new Map(rows.map((r) => [r.id, toRow(r)]));
  }
}
