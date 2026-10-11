import { ATTACHMENT_MAX_BYTES, attachmentListQuerySchema } from "@eyadex/contracts/attachments";
import { idSchema } from "@eyadex/contracts/common";
import { acceptedAttachmentType, SIGNATURE_LENGTH } from "../../files/attachment-type";
import { ApiError } from "../api-error";
import type { MedicalApi } from "../medical-client";
import {
  contentFile,
  parse,
  reachesContent,
  requireKey,
  seesVisit,
  type MedicalAccess,
} from "./mock-medical-access";
import { attachmentView, auditMedical, newestAttachmentFirst } from "./mock-medical-project";
import { attachmentBytes, type StoredAttachment } from "./mock-medical-state";
import { delay, getState, newId, persist, type MockState } from "./mock-store";

// A file's first bytes, through FileReader: jsdom's Blob (the tests' File) has no `arrayBuffer`.
function headOf(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsArrayBuffer(file.slice(0, SIGNATURE_LENGTH));
  });
}

const NAME_MAX = 255;

/**
 * The API's `attachmentName` (domain/attachment-rules.ts): no path, no control or direction marks,
 * trimmed, at most 255 characters, never empty.
 */
function attachmentName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed here
    /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    "",
  );
  const trimmed = [...clean.trim()].slice(0, NAME_MAX).join("");
  return trimmed === "" ? "attachment" : trimmed;
}

function activeAttachment(db: MockState, a: MedicalAccess, id: string) {
  const row = db.medical.attachments.find((x) => x.clinicId === a.clinic.id && x.id === id);
  if (!row || row.status !== "active") throw new ApiError("not_found");
  return row;
}

function attachmentIn(db: MockState, a: MedicalAccess, id: string) {
  const row = activeAttachment(db, a, id);
  contentFile(db, a, "view", row.patientId);
  return row;
}

/** A file's attachments (P2-10): list, upload, download, archive — never delete. */
export function createMockMedicalAttachments(): Pick<
  MedicalApi,
  "listAttachments" | "uploadAttachment" | "downloadAttachment" | "archiveAttachment"
> {
  return {
    async listAttachments(persona, patientId, rawQuery) {
      await delay();
      const db = getState();
      const a = requireKey(db, persona, "view", "medical", ["clinic", "own"]);
      const query = parse(attachmentListQuerySchema, rawQuery);
      const patient = contentFile(db, a, "view", patientId);
      const items = db.medical.attachments
        .filter((x) => x.clinicId === a.clinic.id && x.patientId === patientId)
        .filter((x) => x.status === "active")
        .filter((x) => query.visitId === undefined || x.visitId === query.visitId)
        .sort(newestAttachmentFirst)
        .map((x) => attachmentView(db, x));
      // The list shows file names (clinical information), so it is an audited read like the API's.
      auditMedical(db, a, "patient", "attachment.listed", patientId);
      persist();
      // As the API's list: the caller's own write rule for the file (update reach, active for upload).
      const writes = reachesContent(db, a, "update", patientId);
      return { items, can: { upload: writes && patient.status === "active", archive: writes } };
    },

    async uploadAttachment(persona, patientId, file, visitId) {
      await delay();
      const db = getState();
      const a = requireKey(db, persona, "update", "medical", ["clinic", "own"]);
      // The API's order: the patient id of the path (`idOf`), then `readUpload` (an oversized file, then
      // a malformed visit id), then `Attachments.uploadTarget` (the file's update reach, an active file,
      // the visit), then the bytes.
      if (!idSchema.safeParse(patientId).success) throw new ApiError("not_found");
      if (file.size > ATTACHMENT_MAX_BYTES) throw new ApiError("attachment_too_large");
      if (visitId !== null && !idSchema.safeParse(visitId).success) {
        throw new ApiError("validation");
      }
      const patient = contentFile(db, a, "update", patientId);
      if (patient.status !== "active") throw new ApiError("patient_inactive");
      if (visitId !== null) {
        // An unknown visit, one the caller cannot see and another file's all answer the same.
        const visit = db.medical.visits.find((v) => v.clinicId === a.clinic.id && v.id === visitId);
        if (!visit || !seesVisit(db, a, visit) || visit.patientId !== patientId) {
          throw new ApiError("attachment_patient_mismatch");
        }
      }
      // As the API's `acceptedAttachmentType`: the declared type must be allowed and match the first
      // bytes, so a renamed file is refused and an empty one (no signature) answers `attachment_type`.
      const type = acceptedAttachmentType(file.type, await headOf(file));
      if (type === null) throw new ApiError("attachment_type");
      const row: StoredAttachment = {
        id: newId(),
        clinicId: a.clinic.id,
        patientId,
        visitId,
        name: attachmentName(file.name),
        contentType: type,
        sizeBytes: file.size,
        status: "active",
        uploadedAt: new Date().toISOString(),
        uploadedBy: a.member.id,
      };
      db.medical.attachments.push(row);
      attachmentBytes.set(row.id, file);
      // The file name can carry clinical words: only the field names reach the row.
      auditMedical(db, a, "attachment", "attachment.uploaded", row.id, ["file"]);
      persist();
      return { attachment: attachmentView(db, row) };
    },

    async downloadAttachment(persona, attachmentId) {
      await delay();
      const db = getState();
      const a = requireKey(db, persona, "view", "medical", ["clinic", "own"]);
      const row = attachmentIn(db, a, attachmentId);
      const bytes = attachmentBytes.get(row.id);
      if (!bytes) throw new ApiError("not_found");
      auditMedical(db, a, "attachment", "attachment.downloaded", row.id);
      persist();
      return bytes;
    },

    async archiveAttachment(persona, attachmentId) {
      await delay();
      const db = getState();
      const a = requireKey(db, persona, "update", "medical", ["clinic", "own"]);
      const row = activeAttachment(db, a, attachmentId);
      // As the API: the update reach alone decides the archive; the names go back only to a caller
      // whose view reach covers the file, else both are "" (the contract still needs a name).
      if (!reachesContent(db, a, "update", row.patientId)) throw new ApiError("not_found");
      row.status = "archived";
      auditMedical(db, a, "attachment", "attachment.archived", row.id, ["status"]);
      persist();
      const readable = reachesContent(db, a, "view", row.patientId);
      const shown = attachmentView(db, row);
      return { attachment: readable ? shown : { ...shown, name: "", uploadedByName: "" } };
    },
  };
}
