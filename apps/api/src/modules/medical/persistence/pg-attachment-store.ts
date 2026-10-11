import type { Tx } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";

import type { AttachmentType } from "../domain/attachment-rules.ts";

/** صف مرفق زي ما اتخزّن (0049): الاسم ظرف مشفّر، والمحتوى في المخزن تحت `storageKey`. */
export interface AttachmentRow {
  readonly id: string;
  readonly patientId: string;
  readonly visitId: string | null;
  readonly storageKey: string;
  readonly contentType: AttachmentType;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly nameEnc: string;
  readonly status: "active" | "archived";
  readonly uploadedBy: string;
  readonly createdAt: string;
}

interface Raw {
  id: string;
  patient_id: string;
  visit_id: string | null;
  storage_key: string;
  content_type: AttachmentType;
  size_bytes: number;
  sha256: string;
  name_enc: string;
  status: "active" | "archived";
  uploaded_by: string;
  created_at: string;
}

const COLUMNS = sql`a.id, a.patient_id, a.visit_id, a.storage_key, a.content_type, a.size_bytes,
  a.sha256, a.name_enc, a.status, a.uploaded_by,
  to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at`;

const toRow = (r: Raw): AttachmentRow => ({
  id: r.id,
  patientId: r.patient_id,
  visitId: r.visit_id,
  storageKey: r.storage_key,
  contentType: r.content_type,
  sizeBytes: r.size_bytes,
  sha256: r.sha256,
  nameEnc: r.name_enc,
  status: r.status,
  uploadedBy: r.uploaded_by,
  createdAt: r.created_at,
});

async function select(tx: Tx, where: SQL, tail: SQL = sql``): Promise<AttachmentRow[]> {
  const rows = await tx.execute<Raw>(
    sql`SELECT ${COLUMNS} FROM patient_attachments a WHERE ${where} ${tail}`,
  );
  return rows.map(toRow);
}

/**
 * One attachment, `FOR UPDATE` when `lock` (an archive).
 *
 * @returns the attachment, or `null` when it is not one of this clinic's
 */
export async function findAttachment(
  tx: Tx,
  clinicId: string,
  id: string,
  lock = false,
): Promise<AttachmentRow | null> {
  const rows = await select(
    tx,
    sql`a.clinic_id = ${clinicId} AND a.id = ${id}`,
    lock ? sql`FOR UPDATE` : sql``,
  );
  return rows[0] ?? null;
}

/**
 * A patient's active attachments, newest first, optionally those of one visit (R1-14).
 *
 * @returns the attachments
 */
export function activeAttachmentsOfPatient(
  tx: Tx,
  clinicId: string,
  patientId: string,
  visitId: string | undefined,
): Promise<AttachmentRow[]> {
  const visit = visitId === undefined ? sql`` : sql`AND a.visit_id = ${visitId}`;
  return select(
    tx,
    sql`a.clinic_id = ${clinicId} AND a.patient_id = ${patientId} AND a.status = 'active' ${visit}`,
    sql`ORDER BY a.created_at DESC, a.id DESC`,
  );
}

/**
 * A visit's active attachments, newest first (the visit page).
 *
 * @returns the attachments
 */
export function activeAttachmentsOfVisit(
  tx: Tx,
  clinicId: string,
  visitId: string,
): Promise<AttachmentRow[]> {
  return select(
    tx,
    sql`a.clinic_id = ${clinicId} AND a.visit_id = ${visitId} AND a.status = 'active'`,
    sql`ORDER BY a.created_at DESC, a.id DESC`,
  );
}

/** A visit as an upload needs it: whose it is and where. */
export interface AttachmentVisit {
  readonly patientId: string;
  readonly branchId: string;
}

/**
 * The visit an upload names, `FOR SHARE` when `lock`: the INSERT references it, so it is locked at its
 * place first (ADR-0027: the visit row beside the appointment row, before the patient row).
 *
 * @returns the visit, or `null` when it is not one of this clinic's
 */
export async function visitForAttachment(
  tx: Tx,
  clinicId: string,
  visitId: string,
  lock: boolean,
): Promise<AttachmentVisit | null> {
  const rows = await tx.execute<{ patient_id: string; branch_id: string }>(
    sql`SELECT patient_id, branch_id FROM visits WHERE clinic_id = ${clinicId} AND id = ${visitId}
        ${lock ? sql`FOR SHARE` : sql``}`,
  );
  const r = rows[0];
  return r === undefined ? null : { patientId: r.patient_id, branchId: r.branch_id };
}

/** A new attachment row: the sealed name, the plaintext's size and hash, who uploaded it, when. */
export interface NewAttachment {
  readonly id: string;
  readonly patientId: string;
  readonly visitId: string | null;
  readonly storageKey: string;
  readonly contentType: AttachmentType;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly nameEnc: string;
  readonly uploadedBy: string;
  readonly now: Date;
}

/** Inserts an active attachment, after its blob is stored. */
export async function insertAttachment(tx: Tx, clinicId: string, a: NewAttachment): Promise<void> {
  const at = a.now.toISOString();
  await tx.execute(
    sql`INSERT INTO patient_attachments (clinic_id, id, patient_id, visit_id, storage_key,
          content_type, size_bytes, sha256, name_enc, status, uploaded_by, created_at, updated_at)
        VALUES (${clinicId}, ${a.id}, ${a.patientId}, ${a.visitId}, ${a.storageKey},
          ${a.contentType}, ${a.sizeBytes}, ${a.sha256}, ${a.nameEnc}, 'active', ${a.uploadedBy},
          ${at}::timestamptz, ${at}::timestamptz)`,
  );
}

/** Archives an attachment (never deleted, spec §4). */
export async function archiveAttachment(
  tx: Tx,
  clinicId: string,
  id: string,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE patient_attachments SET status = 'archived', updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${id}`,
  );
}
