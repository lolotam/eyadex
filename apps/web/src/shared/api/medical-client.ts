import type { Attachment } from "@eyadex/contracts/attachments";
import type { Icd10Result } from "@eyadex/contracts/icd10";
import type { MedicalProfile, MedicalProfileInput } from "@eyadex/contracts/medical-profile";
import type { Medicine, MedicineInput } from "@eyadex/contracts/medicines";
import type { Persona } from "@eyadex/contracts/session";
import type {
  PrescriptionPrint,
  VisitDetail,
  VisitList,
  VisitNoteInput,
  VisitStartInput,
  WalkInCandidates,
  DiagnosisInput,
  PrescriptionItemInput,
} from "@eyadex/contracts/visits";

export type WalkInBranch = { id: string; nameAr: string; nameEn: string };
export type VisitCancelInput = {
  reason: "opened_by_mistake" | "patient_left" | "other";
  note: string | null;
};

/**
 * The medical module (P2, spec §5). Every call is rejected with module_disabled while the clinic's
 * medical module is off. Clinical text, names, codes and search text travel in request bodies only,
 * never in a URL (ICD-10 lookup is the contract's one GET query: a code or title word, no patient).
 */
export interface MedicalApi {
  listVisits(persona: Persona, patientId: string, query: { cursor?: string }): Promise<VisitList>;
  searchVisits(
    persona: Persona,
    patientId: string,
    query: { q: string; cursor?: string },
  ): Promise<VisitList>;
  walkInBranches(persona: Persona): Promise<{ items: WalkInBranch[] }>;
  walkInCandidates(
    persona: Persona,
    input: { branchId: string; q: string },
  ): Promise<WalkInCandidates>;
  /** A retry with the same key replays the first result; a changed request is a conflict. */
  startVisit(
    persona: Persona,
    input: VisitStartInput,
    idempotencyKey: string,
  ): Promise<VisitDetail>;
  /** Audited as patient access. */
  getVisit(persona: Persona, visitId: string): Promise<VisitDetail>;
  saveNote(persona: Persona, visitId: string, input: VisitNoteInput): Promise<VisitDetail>;
  saveDiagnoses(
    persona: Persona,
    visitId: string,
    input: { items: DiagnosisInput[] },
  ): Promise<VisitDetail>;
  savePrescription(
    persona: Persona,
    visitId: string,
    input: { items: PrescriptionItemInput[] },
  ): Promise<VisitDetail>;
  signVisit(persona: Persona, visitId: string): Promise<VisitDetail>;
  cancelVisit(persona: Persona, visitId: string, input: VisitCancelInput): Promise<VisitDetail>;
  addAddendum(persona: Persona, visitId: string, input: { body: string }): Promise<VisitDetail>;
  getMedicalProfile(persona: Persona, patientId: string): Promise<MedicalProfile>;
  saveMedicalProfile(
    persona: Persona,
    patientId: string,
    input: MedicalProfileInput,
  ): Promise<MedicalProfile>;
  searchIcd10(persona: Persona, q: string): Promise<Icd10Result>;
  listMedicines(persona: Persona): Promise<{ items: Medicine[] }>;
  createMedicine(persona: Persona, input: MedicineInput, idempotencyKey: string): Promise<Medicine>;
  updateMedicine(persona: Persona, id: string, input: MedicineInput): Promise<Medicine>;
  deactivateMedicine(persona: Persona, id: string): Promise<Medicine>;
  reactivateMedicine(persona: Persona, id: string): Promise<Medicine>;
  /** Active attachments of the file, or of one visit when `visitId` is given. */
  listAttachments(
    persona: Persona,
    patientId: string,
    query: { visitId?: string },
  ): Promise<{ items: Attachment[] }>;
  /** Multipart `file` + optional `visitId`. TODO(spec): the contract has no upload answer schema. */
  uploadAttachment(
    persona: Persona,
    patientId: string,
    file: File,
    visitId: string | null,
  ): Promise<void>;
  /** Audited. */
  downloadAttachment(persona: Persona, attachmentId: string): Promise<Blob>;
  archiveAttachment(persona: Persona, attachmentId: string): Promise<void>;
  /** Audited. */
  getPrescriptionPrint(persona: Persona, visitId: string): Promise<PrescriptionPrint>;
}
