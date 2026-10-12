import type { Tx } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";

import type { DuplicateFile, PatientRecord } from "../domain/patient-rules.ts";
import type { CivilIdCodec, CivilIdColumns } from "./civil-id-codec.ts";

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
  civil_id_enc: string | null;
  status: PatientRecord["status"];
}

/**
 * The columns of one file, with the date as text (the contract wants YYYY-MM-DD, not a Date), and the
 * civil ID as its envelope (ADR-0028).
 */
export const PATIENT_COLUMNS = sql`p.id, p.file_number, p.full_name, p.phone,
  p.birth_date::text AS birth_date, p.gender, p.registration_branch_id, p.civil_id_enc, p.status`;

/** One stored file as a record, its civil ID decrypted. */
export const toRecord = (
  row: PatientRow,
  clinicId: string,
  civilIds: CivilIdCodec,
): PatientRecord => ({
  id: row.id,
  fileNumber: Number(row.file_number),
  fullName: row.full_name,
  phone: row.phone,
  birthDate: row.birth_date,
  gender: row.gender,
  registrationBranchId: row.registration_branch_id,
  civilId: civilIds.read(clinicId, row.id, row.civil_id_enc),
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
  civilIds: CivilIdCodec,
  clinicId: string,
  id: string,
  forUpdate = false,
): Promise<PatientRecord | null> {
  const lock = forUpdate ? sql` FOR UPDATE` : sql``;
  const rows = await tx.execute<PatientRow>(
    sql`SELECT ${PATIENT_COLUMNS} FROM patients p
        WHERE p.clinic_id = ${clinicId} AND p.id = ${id}${lock}`,
  );
  return rows[0] === undefined ? null : toRecord(rows[0], clinicId, civilIds);
}

async function findDuplicate(
  tx: Tx,
  clinicId: string,
  match: SQL,
  exceptId: string | null,
): Promise<DuplicateFile | null> {
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
  findDuplicate(tx, clinicId, sql`p.phone = ${phone}`, exceptId);

/**
 * Another file of this clinic holding this civil ID (archived ones included), or null, found by its
 * blind index (0045).
 */
export const findCivilIdOwner = (
  tx: Tx,
  civilIds: CivilIdCodec,
  clinicId: string,
  civilId: string,
  exceptId: string | null,
) =>
  findDuplicate(
    tx,
    clinicId,
    sql`p.civil_id_hmac = ${civilIds.index(clinicId, civilId)}`,
    exceptId,
  );

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

/** The SET list that stores one civil ID: its three encrypted columns, or three nulls. */
const civilIdAssignments = (civil: CivilIdColumns): SQL =>
  sql`civil_id_enc = ${civil.enc}, civil_id_hmac = ${civil.hmac}, civil_id_last4 = ${civil.last4}`;

/** Inserts a new file with the record's id, file number and status; the civil ID only encrypted. */
export async function insertPatient(
  tx: Tx,
  civilIds: CivilIdCodec,
  clinicId: string,
  record: PatientRecord,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  const civil = civilIds.columns(clinicId, record.id, record.civilId);
  await tx.execute(
    sql`INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender,
          registration_branch_id, civil_id_enc, civil_id_hmac, civil_id_last4, status,
          created_at, updated_at)
        VALUES (${clinicId}, ${record.id}, ${String(record.fileNumber)}, ${record.fullName},
          ${record.phone}, ${record.birthDate}::date, ${record.gender},
          ${record.registrationBranchId}, ${civil.enc}, ${civil.hmac}, ${civil.last4},
          ${record.status}, ${at}::timestamptz, ${at}::timestamptz)`,
  );
}

/**
 * Replaces the editable fields of one file (the file number and status never change here); the civil
 * ID is sealed again.
 */
export async function updatePatientFields(
  tx: Tx,
  civilIds: CivilIdCodec,
  clinicId: string,
  record: PatientRecord,
  now: Date,
): Promise<void> {
  const civil = civilIds.columns(clinicId, record.id, record.civilId);
  await tx.execute(
    sql`UPDATE patients SET full_name = ${record.fullName}, phone = ${record.phone},
          birth_date = ${record.birthDate}::date, gender = ${record.gender},
          registration_branch_id = ${record.registrationBranchId}, ${civilIdAssignments(civil)},
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
