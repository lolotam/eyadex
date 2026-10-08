import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { DuplicateFile, PatientRecord } from "../domain/patient-rules.ts";

// Every statement here runs inside the caller's withTenant(clinicId) transaction AND filters on
// clinic_id itself: RLS and the explicit predicate are two independent layers (ISO-01).

interface PatientRow {
  id: string;
  file_number: string;
  full_name: string;
  phone: string;
  birth_date: string;
  gender: PatientRecord["gender"];
  registration_branch_id: string;
  civil_id: string | null;
  status: PatientRecord["status"];
}

/** The columns of one file, with the date as text (the contract wants YYYY-MM-DD, not a Date). */
export const PATIENT_COLUMNS = sql`p.id, p.file_number, p.full_name, p.phone,
  p.birth_date::text AS birth_date, p.gender, p.registration_branch_id, p.civil_id, p.status`;

export const toRecord = (row: PatientRow): PatientRecord => ({
  id: row.id,
  fileNumber: Number(row.file_number),
  fullName: row.full_name,
  phone: row.phone,
  birthDate: row.birth_date,
  gender: row.gender,
  registrationBranchId: row.registration_branch_id,
  civilId: row.civil_id,
  status: row.status,
});

/**
 * Serialises every patient write of one clinic (create, update, archive, restore), so the duplicate
 * checks and the decision that follows cannot race a parallel write. Never taken by branch writes.
 */
export async function lockClinicPatients(tx: Tx, clinicId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`patients:${clinicId}`}, 0))`,
  );
}

/** One file of this clinic, or null; `FOR UPDATE` when the caller is about to change it. */
export async function findPatient(
  tx: Tx,
  clinicId: string,
  id: string,
  forUpdate = false,
): Promise<PatientRecord | null> {
  const lock = forUpdate ? sql` FOR UPDATE` : sql``;
  const rows = await tx.execute<PatientRow>(
    sql`SELECT ${PATIENT_COLUMNS} FROM patients p
        WHERE p.clinic_id = ${clinicId} AND p.id = ${id}${lock}`,
  );
  return rows[0] === undefined ? null : toRecord(rows[0]);
}

/**
 * The target branch of a create or a move, read `FOR SHARE` so a parallel deactivation waits for this
 * transaction. Branches belong to tenancy; patients → tenancy is an allowed arrow (ADR-0018).
 */
export async function findBranchForFiling(
  tx: Tx,
  clinicId: string,
  branchId: string,
): Promise<{ isActive: boolean } | null> {
  const rows = await tx.execute<{ is_active: boolean }>(
    sql`SELECT is_active FROM branches WHERE clinic_id = ${clinicId} AND id = ${branchId} FOR SHARE`,
  );
  return rows[0] === undefined ? null : { isActive: rows[0].is_active };
}

async function findDuplicate(
  tx: Tx,
  clinicId: string,
  column: "phone" | "civil_id",
  value: string,
  exceptId: string | null,
): Promise<DuplicateFile | null> {
  const match = column === "phone" ? sql`p.phone = ${value}` : sql`p.civil_id = ${value}`;
  const rows = await tx.execute<{
    id: string;
    file_number: string;
    registration_branch_id: string;
  }>(
    sql`SELECT p.id, p.file_number, p.registration_branch_id FROM patients p
        WHERE p.clinic_id = ${clinicId} AND ${match}
          AND (${exceptId}::uuid IS NULL OR p.id <> ${exceptId}::uuid)
        LIMIT 1`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    fileNumber: Number(row.file_number),
    registrationBranchId: row.registration_branch_id,
  };
}

/** Another file of this clinic with this phone (any status), or null (PAT-02). */
export const findPhoneOwner = (tx: Tx, clinicId: string, phone: string, exceptId: string | null) =>
  findDuplicate(tx, clinicId, "phone", phone, exceptId);

/** Another file of this clinic holding this civil ID (archived ones included, 0021), or null. */
export const findCivilIdOwner = (
  tx: Tx,
  clinicId: string,
  civilId: string,
  exceptId: string | null,
) => findDuplicate(tx, clinicId, "civil_id", civilId, exceptId);

/**
 * The clinic's next file number (0019): the upsert locks the counter row, so parallel creates get
 * distinct numbers, and a rolled-back create only leaves a gap (PAT-01).
 */
export async function nextFileNumber(tx: Tx, clinicId: string, now: Date): Promise<number> {
  const rows = await tx.execute<{ value: string }>(
    sql`INSERT INTO clinic_counters (clinic_id, name, value, updated_at)
        VALUES (${clinicId}, 'patient_file_number', 1, ${now.toISOString()}::timestamptz)
        ON CONFLICT (clinic_id, name)
        DO UPDATE SET value = clinic_counters.value + 1, updated_at = EXCLUDED.updated_at
        RETURNING value`,
  );
  const value = Number(rows[0]?.value);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("file number counter is invalid");
  return value;
}

/** Inserts a new file with the record's id, file number and status. */
export async function insertPatient(
  tx: Tx,
  clinicId: string,
  record: PatientRecord,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender,
          registration_branch_id, civil_id, status, created_at, updated_at)
        VALUES (${clinicId}, ${record.id}, ${String(record.fileNumber)}, ${record.fullName},
          ${record.phone}, ${record.birthDate}::date, ${record.gender},
          ${record.registrationBranchId}, ${record.civilId}, ${record.status},
          ${at}::timestamptz, ${at}::timestamptz)`,
  );
}

/** Replaces the editable fields of one file (the file number and status never change here). */
export async function updatePatientFields(
  tx: Tx,
  clinicId: string,
  record: PatientRecord,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE patients SET full_name = ${record.fullName}, phone = ${record.phone},
          birth_date = ${record.birthDate}::date, gender = ${record.gender},
          registration_branch_id = ${record.registrationBranchId}, civil_id = ${record.civilId},
          updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${record.id}`,
  );
}

/** Archive or restore: the only status change; nothing is ever deleted. */
export async function setPatientStatus(
  tx: Tx,
  clinicId: string,
  record: PatientRecord,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE patients SET status = ${record.status},
          updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${record.id}`,
  );
}
