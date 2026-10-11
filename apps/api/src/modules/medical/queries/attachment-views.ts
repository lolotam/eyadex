import type { Attachment } from "@eyadex/contracts/attachments";

import type { AttachmentRow } from "../persistence/pg-attachment-store.ts";
import type { FieldRef } from "../ports/clinical-cipher.ts";
import type { ReadContext } from "../use-cases/medical-deps.ts";

// The FK-less uploader column can name a membership that no longer resolves; the dash is the placeholder.
const NO_NAME = "—";

/**
 * Where an attachment's file name is sealed (ADR-0028): its own row's `name_enc`.
 *
 * @returns the field reference
 */
export const attachmentNameRef = (attachmentId: string): FieldRef => ({
  table: "patient_attachments",
  column: "name_enc",
  rowId: attachmentId,
});

/**
 * Where an attachment's content is sealed: `patient_attachments:blob:<clinicId>:<attachmentId>` (plan
 * Task 10), so a blob copied under another attachment or clinic never opens.
 *
 * @returns the field reference
 */
export const attachmentBlobRef = (attachmentId: string): FieldRef => ({
  table: "patient_attachments",
  column: "blob",
  rowId: attachmentId,
});

/**
 * Stored attachments as the contract shows them: the file name opened, the uploader named, in one
 * member lookup.
 *
 * @param reads the medical transaction, cipher and ports
 * @param clinicId the clinic
 * @param rows the stored attachments, in display order
 * @returns the attachments
 */
export async function attachmentViews(
  reads: Pick<ReadContext, "tx" | "cipher" | "members">,
  clinicId: string,
  rows: readonly AttachmentRow[],
): Promise<Attachment[]> {
  if (rows.length === 0) return [];
  const members = await reads.members.findMany(reads.tx, clinicId, [
    ...new Set(rows.map((r) => r.uploadedBy)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    patientId: r.patientId,
    visitId: r.visitId,
    name: reads.cipher.open(clinicId, attachmentNameRef(r.id), r.nameEnc),
    contentType: r.contentType,
    sizeBytes: r.sizeBytes,
    status: r.status,
    uploadedAt: new Date(r.createdAt).toISOString(),
    uploadedByName: members.get(r.uploadedBy)?.fullName ?? NO_NAME,
  }));
}

/**
 * An attachment answered to a caller who may change it but not read it (`update:medical:clinic` with
 * only `view:medical:own`, on another member's patient): the frozen contract needs a `name`, so the file
 * name and the uploader's name are empty strings, and nothing is opened or looked up.
 *
 * @param row the stored attachment
 * @returns the attachment without its name or uploader
 */
export const redactedAttachmentView = (row: AttachmentRow): Attachment => ({
  id: row.id,
  patientId: row.patientId,
  visitId: row.visitId,
  name: "",
  contentType: row.contentType,
  sizeBytes: row.sizeBytes,
  status: row.status,
  uploadedAt: new Date(row.createdAt).toISOString(),
  uploadedByName: "",
});
