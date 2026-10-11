import {
  ATTACHMENT_MAX_BYTES,
  attachmentListQuerySchema,
  type Attachment,
} from "@eyadex/contracts/attachments";
import { icd10QuerySchema } from "@eyadex/contracts/icd10";
import {
  medicalProfileInputSchema,
  type MedicalProfile,
  type MedicalProfileInput,
} from "@eyadex/contracts/medical-profile";
import { acceptedAttachmentType, SIGNATURE_LENGTH } from "../../files/attachment-type";
import { ApiError } from "../api-error";
import type { MedicalApi } from "../medical-client";
import { ICD10_DEMO, ICD10_RELEASE } from "./mock-icd10-list";
import {
  parse,
  patientOf,
  reachesContent,
  requireKey,
  seesVisit,
  visibleVisit,
  type MedicalAccess,
} from "./mock-medical-access";
import { auditMedical } from "./mock-medical-project";
import { attachmentBytes, type StoredAttachment } from "./mock-medical-state";
import { delay, getState, newId, persist, type MockState } from "./mock-store";

const PROFILE_FIELDS = [
  "allergies",
  "chronicConditions",
  "currentMedications",
  "surgicalHistory",
  "familyHistory",
] as const;

/**
 * The medical file's reach for the action alone, as the API's use cases (`reachable`, `patientInReach`):
 * a write needs only the update reach, a read only the view reach, and a file outside it is not_found
 * (cannot be probed).
 */
function contentFile(
  db: MockState,
  a: MedicalAccess,
  action: "view" | "update",
  patientId: string,
) {
  const patient = patientOf(db, a, patientId);
  if (!reachesContent(db, a, action, patientId)) throw new ApiError("not_found");
  return patient;
}

function profileOf(db: MockState, a: MedicalAccess, patientId: string): MedicalProfile {
  const row = db.medical.profiles.find(
    (p) => p.clinicId === a.clinic.id && p.patientId === patientId,
  );
  const profile = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, row?.[f] ?? null]));
  return {
    profile: profile as MedicalProfile["profile"],
    updatedAt: row?.updatedAt ?? null,
    updatedByName: row?.updatedByName ?? null,
    // An archived file is never written (`patient_inactive`), so it offers no edit (as the API).
    can: {
      update:
        patientOf(db, a, patientId).status === "active" &&
        reachesContent(db, a, "update", patientId),
    },
  };
}

// A file's first bytes, through FileReader: jsdom's Blob (the tests' File) has no `arrayBuffer`.
function headOf(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsArrayBuffer(file.slice(0, SIGNATURE_LENGTH));
  });
}

const view = ({ clinicId: _clinic, ...rest }: StoredAttachment): Attachment => rest;

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

export function createMockMedicalFiles(): Pick<
  MedicalApi,
  | "getMedicalProfile"
  | "saveMedicalProfile"
  | "searchIcd10"
  | "listAttachments"
  | "uploadAttachment"
  | "downloadAttachment"
  | "archiveAttachment"
  | "getPrescriptionPrint"
> {
  return {
    async getMedicalProfile(persona, patientId) {
      await delay();
      const db = getState();
      const a = requireKey(db, persona, "view", "medical", ["clinic", "own"]);
      contentFile(db, a, "view", patientId);
      auditMedical(db, a, "medical_profile", "medical_profile.opened", patientId);
      persist();
      return profileOf(db, a, patientId);
    },

    async saveMedicalProfile(persona, patientId, rawInput: MedicalProfileInput) {
      await delay();
      const db = getState();
      const input = parse(medicalProfileInputSchema, rawInput);
      const a = requireKey(db, persona, "update", "medical", ["clinic", "own"]);
      const patient = contentFile(db, a, "update", patientId);
      if (patient.status !== "active") throw new ApiError("patient_inactive");
      const before = profileOf(db, a, patientId).profile;
      const next = Object.fromEntries(
        PROFILE_FIELDS.map((f) => [f, input[f] && input[f].length > 0 ? input[f] : null]),
      ) as MedicalProfile["profile"];
      const changed = PROFILE_FIELDS.filter((f) => before[f] !== next[f]);
      if (changed.length === 0) {
        // Nothing to write, but the answer carries the five sections: a read, logged like the API's.
        auditMedical(db, a, "medical_profile", "medical_profile.opened", patientId);
        persist();
        return profileOf(db, a, patientId);
      }
      db.medical.profiles = db.medical.profiles.filter(
        (p) => !(p.clinicId === a.clinic.id && p.patientId === patientId),
      );
      db.medical.profiles.push({
        clinicId: a.clinic.id,
        patientId,
        ...next,
        updatedAt: new Date().toISOString(),
        updatedByName: a.actorName,
      });
      auditMedical(db, a, "medical_profile", "medical_profile.saved", patientId, changed);
      persist();
      return profileOf(db, a, patientId);
    },

    async searchIcd10(persona, rawQ) {
      await delay(80);
      const db = getState();
      const { q } = parse(icd10QuerySchema, { q: rawQ });
      requireKey(db, persona, "view", "medical", ["clinic", "own"]);
      const needle = q.toLocaleLowerCase();
      const words = needle.split(/\s+/).filter(Boolean);
      const items = ICD10_DEMO.filter(
        (c) =>
          c.code.toLocaleLowerCase().startsWith(needle) ||
          words.every((w) => c.title.toLocaleLowerCase().includes(w)),
      ).slice(0, 20);
      return { items: [...items], release: ICD10_RELEASE };
    },

    async listAttachments(persona, patientId, rawQuery) {
      await delay();
      const db = getState();
      const query = parse(attachmentListQuerySchema, rawQuery);
      const a = requireKey(db, persona, "view", "medical", ["clinic", "own"]);
      const patient = contentFile(db, a, "view", patientId);
      const items = db.medical.attachments
        .filter((x) => x.clinicId === a.clinic.id && x.patientId === patientId)
        .filter((x) => x.status === "active")
        .filter((x) => query.visitId === undefined || x.visitId === query.visitId)
        .sort((x, y) => y.uploadedAt.localeCompare(x.uploadedAt))
        .map(view);
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
      // The API's order: `readUpload` refuses an oversized file before the use case runs; then
      // `Attachments.uploadTarget` (the file's update reach, an active file, the visit), then the bytes.
      if (file.size > ATTACHMENT_MAX_BYTES) throw new ApiError("attachment_too_large");
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
        name: file.name.slice(0, 200) || "file",
        contentType: type,
        sizeBytes: file.size,
        status: "active",
        uploadedAt: new Date().toISOString(),
        uploadedByName: a.actorName,
      };
      db.medical.attachments.push(row);
      attachmentBytes.set(row.id, file);
      // The file name can carry clinical words: only the field names reach the row.
      auditMedical(db, a, "attachment", "attachment.uploaded", row.id, ["file"]);
      persist();
      return { attachment: view(row) };
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
      auditMedical(db, a, "attachment", "attachment.archived", row.id, [], "archived");
      persist();
      const readable = reachesContent(db, a, "view", row.patientId);
      return { attachment: readable ? view(row) : { ...view(row), name: "", uploadedByName: "" } };
    },

    async getPrescriptionPrint(persona, visitId) {
      await delay();
      const db = getState();
      const a = requireKey(db, persona, "view", "medical", ["clinic", "own"]);
      const v = visibleVisit(db, a, visitId);
      if (!reachesContent(db, a, "view", v.patientId)) throw new ApiError("not_found");
      const patient = db.patients.find((p) => p.id === v.patientId);
      const branch = db.branches.find((b) => b.id === v.branchId);
      auditMedical(db, a, "prescription", "visit.prescription_printed", v.id);
      persist();
      return {
        clinic: { nameAr: a.clinic.nameAr, nameEn: a.clinic.nameEn },
        branch: { nameAr: branch?.nameAr ?? "", nameEn: branch?.nameEn ?? "" },
        patient: { fullName: patient?.fullName ?? "", fileNumber: patient?.fileNumber ?? 0 },
        providerName: db.members.find((m) => m.id === v.providerMembershipId)?.fullName ?? "",
        startedAt: v.startedAt,
        signedAt: v.signedAt,
        items: v.prescription
          .filter((p) => !p.archived)
          .map(({ archived: _archived, ...item }) => item),
      };
    },
  };
}
