// Medical module strings (P2): the error codes frozen with the contracts (R1-11) and the clinic audit
// log's labels (R3-4). The screens' own strings arrive with the web plan (P2 Task 13).
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

export const enMedicalAuditEntities = {
  visit: "Visit",
  visit_addendum: "Visit addendum",
  diagnosis: "Diagnosis",
  prescription: "Prescription",
  medical_profile: "Medical file",
  attachment: "Attachment",
  medicine: "Medicine",
};

export const enMedicalAuditActions = {
  visit: {
    started: "Visit started",
    opened: "Visit opened",
    note_saved: "Visit note saved",
    signed: "Visit signed",
    cancelled: "Visit cancelled",
    addendum_added: "Addendum added",
    diagnoses_saved: "Diagnoses saved",
    prescription_saved: "Prescription saved",
    prescription_printed: "Prescription printed",
    searched: "Visit notes searched",
    walk_in_searched: "Walk-in patient searched",
    previews_listed: "Visit previews listed",
  },
  medical_profile: { opened: "Medical file opened", saved: "Medical file saved" },
  attachment: {
    uploaded: "Attachment uploaded",
    downloaded: "Attachment downloaded",
    archived: "Attachment archived",
    listed: "Attachments listed",
  },
  medicine: {
    created: "Medicine added",
    updated: "Medicine updated",
    deactivated: "Medicine deactivated",
    reactivated: "Medicine reactivated",
  },
};

/**
 * The names a medical audit row lists in `after.changed` (field names only, R3-4), from every
 * `auditMedical` write of the API and the mock, and the label of that list.
 */
export const enMedicalAuditFields = {
  changed: "Changed fields",
  complaint: "Complaint",
  examination: "Examination",
  assessment: "Assessment",
  plan: "Plan",
  cancelNote: "Cancellation note",
  body: "Text",
  items: "Items",
  file: "File",
  allergies: "Allergies",
  chronicConditions: "Chronic conditions",
  currentMedications: "Current medications",
  surgicalHistory: "Surgical history",
  familyHistory: "Family history",
  name: "Name",
  defaultDose: "Default dose",
  defaultFrequency: "Default frequency",
  reason: "Reason",
  note: "Note",
};
