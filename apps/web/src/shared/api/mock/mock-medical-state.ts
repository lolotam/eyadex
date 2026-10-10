import type { VisitStatus } from "@eyadex/contracts/visits";

// The mock's medical store (P2). Demo only: plaintext, where the API encrypts (P2-11).

export type StoredNote = {
  complaint: string | null;
  examination: string | null;
  assessment: string | null;
  plan: string | null;
};
export type StoredDiagnosis = {
  position: number;
  kind: "icd10" | "text";
  code: string | null;
  text: string;
  /** A removed row is archived, never shown again and never deleted. */
  archived: boolean;
};
export type StoredPrescriptionItem = {
  position: number;
  medicine: string;
  dose: string;
  frequency: string;
  duration: string;
  note: string | null;
  archived: boolean;
};
export type StoredAddendum = {
  id: string;
  authorMembershipId: string;
  body: string;
  createdAt: string;
};
export type StoredVisit = {
  id: string;
  clinicId: string;
  patientId: string;
  branchId: string;
  providerMembershipId: string;
  appointmentId: string | null;
  status: VisitStatus;
  startedAt: string;
  signedAt: string | null;
  cancelReason: string | null;
  cancelNote: string | null;
  note: StoredNote;
  diagnoses: StoredDiagnosis[];
  prescription: StoredPrescriptionItem[];
  addenda: StoredAddendum[];
};
export type StoredProfile = {
  clinicId: string;
  patientId: string;
  allergies: string | null;
  chronicConditions: string | null;
  currentMedications: string | null;
  surgicalHistory: string | null;
  familyHistory: string | null;
  updatedAt: string;
  updatedByName: string;
};
export type StoredMedicine = {
  id: string;
  clinicId: string;
  name: string;
  defaultDose: string | null;
  defaultFrequency: string | null;
  status: "active" | "inactive";
};
export type StoredAttachment = {
  id: string;
  clinicId: string;
  patientId: string;
  visitId: string | null;
  name: string;
  contentType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  sizeBytes: number;
  status: "active" | "archived";
  uploadedAt: string;
  uploadedByName: string;
};

export type MedicalState = {
  visits: StoredVisit[];
  profiles: StoredProfile[];
  medicines: StoredMedicine[];
  attachments: StoredAttachment[];
  /** Idempotency-Key replay ledgers: "clinicId:actorMemberId:key" -> id + request fingerprint. */
  idempotentVisits: Record<string, { visitId: string; fingerprint: string }>;
  idempotentMedicines: Record<string, { medicineId: string; fingerprint: string }>;
};

export const EMPTY_MEDICAL = (): MedicalState => ({
  visits: [],
  profiles: [],
  medicines: [],
  attachments: [],
  idempotentVisits: {},
  idempotentMedicines: {},
});

/** File bytes stay in memory only (never in browser storage); a reload keeps the list, not the bytes. */
export const attachmentBytes = new Map<string, Blob>();
