// Medical module strings (P2): the error codes frozen with the contracts (R1-11). The screens' own
// strings arrive with the web plan (P2 Task 13).
export const enMedicalErrors = {
  appointment_not_arrived: "A visit starts only once the patient has arrived for the appointment",
  visit_exists: "This appointment already has a visit",
  visit_signed: "The visit is signed and cannot be changed; add an addendum instead",
  visit_not_signed: "An addendum can be added only after the visit is signed",
  visit_not_provider: "Only the visit's provider can change or sign it",
  visit_empty: "Write something in the visit note before signing it",
  icd10_unknown: "This ICD-10-CM code is not in the list",
  medicine_name_taken: "Another medicine in the clinic list already uses this name",
  attachment_too_large: "The file is larger than 20 MB",
  attachment_type: "This file type is not supported; upload a JPEG, PNG or WebP image or a PDF",
  attachment_patient_mismatch: "This visit does not belong to this patient's file",
  role_self_change: "You cannot change your own role",
};
