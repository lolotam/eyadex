import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { appointments } from "./appointments.ts";
import { branches } from "./branches.ts";
import { clinics } from "./clinics.ts";
import { memberships } from "./memberships.ts";
import { patients } from "./patients.ts";

// Mirror of db/sql/0046 (P2 spec §4). Clinic tables: forced RLS, eyadex_app only, never deleted. Every
// `*_enc` column holds a FieldCipher envelope (ADR-0028); actor columns are membership ids with no
// foreign key (ADR-0027).
const tz = { withTimezone: true, mode: "date" } as const;

// Shared with the visit lists' mirror (medical-lists.ts); schema/index.ts exports tables only.
export const envelope = (table: string, column: string) =>
  check(`${table}_${column}_check`, sql.raw(`(${column} ~ '^f1\\.[0-9]+\\.'::text)`));

export const visits = pgTable(
  "visits",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    providerMembershipId: uuid("provider_membership_id").notNull(),
    appointmentId: uuid("appointment_id"),
    status: text("status", { enum: ["draft", "signed", "cancelled"] }).notNull(),
    startedAt: timestamp("started_at", tz).notNull(),
    signedAt: timestamp("signed_at", tz),
    signedBy: uuid("signed_by"),
    cancelReason: text("cancel_reason", {
      enum: ["opened_by_mistake", "patient_left", "other"],
    }),
    cancelNoteEnc: text("cancel_note_enc"),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "visits_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "visits_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "visits_clinic_id_branch_id_fkey",
      columns: [t.clinicId, t.branchId],
      foreignColumns: [branches.clinicId, branches.id],
    }),
    foreignKey({
      name: "visits_clinic_id_patient_id_fkey",
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
    foreignKey({
      name: "visits_clinic_id_provider_membership_id_fkey",
      columns: [t.clinicId, t.providerMembershipId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }),
    foreignKey({
      name: "visits_clinic_id_appointment_id_fkey",
      columns: [t.clinicId, t.appointmentId],
      foreignColumns: [appointments.clinicId, appointments.id],
    }),
    uniqueIndex("visits_clinic_appointment_live")
      .on(t.clinicId, t.appointmentId)
      .where(sql`(appointment_id IS NOT NULL) AND (status <> 'cancelled'::text)`),
    index("visits_clinic_appointment_idx").on(t.clinicId, t.appointmentId),
    index("visits_clinic_patient_started_idx").on(
      t.clinicId,
      t.patientId,
      t.startedAt.desc().nullsFirst(),
    ),
    index("visits_clinic_branch_started_idx").on(t.clinicId, t.branchId, t.startedAt),
    index("visits_clinic_provider_patient_idx").on(t.clinicId, t.providerMembershipId, t.patientId),
    check(
      "visits_status_check",
      sql.raw("(status = ANY (ARRAY['draft'::text, 'signed'::text, 'cancelled'::text]))"),
    ),
    check(
      "visits_cancel_reason_check",
      sql.raw(
        "(cancel_reason = ANY (ARRAY['opened_by_mistake'::text, 'patient_left'::text, 'other'::text]))",
      ),
    ),
    envelope("visits", "cancel_note_enc"),
    check(
      "visits_signed_check",
      sql.raw(
        "(((status = 'signed'::text) = (signed_at IS NOT NULL)) AND ((signed_at IS NULL) = (signed_by IS NULL)))",
      ),
    ),
    check(
      "visits_cancelled_check",
      sql.raw(
        "(((status = 'cancelled'::text) = (cancel_reason IS NOT NULL)) AND ((cancel_note_enc IS NULL) OR (status = 'cancelled'::text)))",
      ),
    ),
  ],
);

export const visitNotes = pgTable(
  "visit_notes",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    visitId: uuid("visit_id").notNull(),
    complaintEnc: text("complaint_enc"),
    examinationEnc: text("examination_enc"),
    assessmentEnc: text("assessment_enc"),
    planEnc: text("plan_enc"),
    updatedBy: uuid("updated_by").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "visit_notes_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "visit_notes_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "visit_notes_clinic_id_visit_id_fkey",
      columns: [t.clinicId, t.visitId],
      foreignColumns: [visits.clinicId, visits.id],
    }),
    uniqueIndex("visit_notes_clinic_visit_unique").on(t.clinicId, t.visitId),
    envelope("visit_notes", "complaint_enc"),
    envelope("visit_notes", "examination_enc"),
    envelope("visit_notes", "assessment_enc"),
    envelope("visit_notes", "plan_enc"),
  ],
);

export const visitAddenda = pgTable(
  "visit_addenda",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    visitId: uuid("visit_id").notNull(),
    authorMembershipId: uuid("author_membership_id").notNull(),
    bodyEnc: text("body_enc").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "visit_addenda_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "visit_addenda_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "visit_addenda_clinic_id_visit_id_fkey",
      columns: [t.clinicId, t.visitId],
      foreignColumns: [visits.clinicId, visits.id],
    }),
    index("visit_addenda_clinic_visit_created_idx").on(t.clinicId, t.visitId, t.createdAt),
    envelope("visit_addenda", "body_enc"),
  ],
);

export const patientMedicalProfiles = pgTable(
  "patient_medical_profiles",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    patientId: uuid("patient_id").notNull(),
    allergiesEnc: text("allergies_enc"),
    chronicConditionsEnc: text("chronic_conditions_enc"),
    currentMedicationsEnc: text("current_medications_enc"),
    surgicalHistoryEnc: text("surgical_history_enc"),
    familyHistoryEnc: text("family_history_enc"),
    updatedBy: uuid("updated_by").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "patient_medical_profiles_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "patient_medical_profiles_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "patient_medical_profiles_clinic_id_patient_id_fkey",
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
    uniqueIndex("patient_medical_profiles_clinic_patient_unique").on(t.clinicId, t.patientId),
    envelope("patient_medical_profiles", "allergies_enc"),
    envelope("patient_medical_profiles", "chronic_conditions_enc"),
    envelope("patient_medical_profiles", "current_medications_enc"),
    envelope("patient_medical_profiles", "surgical_history_enc"),
    envelope("patient_medical_profiles", "family_history_enc"),
  ],
);
