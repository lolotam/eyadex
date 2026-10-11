import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { clinics } from "./clinics.ts";
import { envelope, visits } from "./medical.ts";

// Mirror of db/sql/0047 and 0048 (P2 spec §4, R1-13): a visit's diagnoses and prescription items, each
// list replaced whole on a draft by archiving its active rows. Every `*_enc` column holds a FieldCipher
// envelope bound to its own row (ADR-0028).
const tz = { withTimezone: true, mode: "date" } as const;

export const visitDiagnoses = pgTable(
  "visit_diagnoses",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    visitId: uuid("visit_id").notNull(),
    position: smallint("position").notNull(),
    kind: text("kind", { enum: ["icd10", "text"] }).notNull(),
    codeEnc: text("code_enc"),
    textEnc: text("text_enc").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    archivedAt: timestamp("archived_at", tz),
  },
  (t) => [
    primaryKey({ name: "visit_diagnoses_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "visit_diagnoses_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "visit_diagnoses_clinic_id_visit_id_fkey",
      columns: [t.clinicId, t.visitId],
      foreignColumns: [visits.clinicId, visits.id],
    }),
    uniqueIndex("visit_diagnoses_clinic_visit_position_active")
      .on(t.clinicId, t.visitId, t.position)
      .where(sql`archived_at IS NULL`),
    index("visit_diagnoses_clinic_visit_idx").on(t.clinicId, t.visitId),
    check("visit_diagnoses_position_check", sql.raw('(("position" >= 0) AND ("position" <= 19))')),
    check(
      "visit_diagnoses_kind_check",
      sql.raw("(kind = ANY (ARRAY['icd10'::text, 'text'::text]))"),
    ),
    check(
      "visit_diagnoses_code_check",
      sql.raw("((kind = 'icd10'::text) = (code_enc IS NOT NULL))"),
    ),
    envelope("visit_diagnoses", "code_enc"),
    envelope("visit_diagnoses", "text_enc"),
  ],
);

export const visitPrescriptionItems = pgTable(
  "visit_prescription_items",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    visitId: uuid("visit_id").notNull(),
    position: smallint("position").notNull(),
    medicineEnc: text("medicine_enc").notNull(),
    doseEnc: text("dose_enc").notNull(),
    frequencyEnc: text("frequency_enc").notNull(),
    durationEnc: text("duration_enc").notNull(),
    noteEnc: text("note_enc"),
    createdAt: timestamp("created_at", tz).notNull(),
    archivedAt: timestamp("archived_at", tz),
  },
  (t) => [
    primaryKey({ name: "visit_prescription_items_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "visit_prescription_items_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "visit_prescription_items_clinic_id_visit_id_fkey",
      columns: [t.clinicId, t.visitId],
      foreignColumns: [visits.clinicId, visits.id],
    }),
    uniqueIndex("visit_prescription_items_clinic_visit_position_active")
      .on(t.clinicId, t.visitId, t.position)
      .where(sql`archived_at IS NULL`),
    index("visit_prescription_items_clinic_visit_idx").on(t.clinicId, t.visitId),
    check(
      "visit_prescription_items_position_check",
      sql.raw('(("position" >= 0) AND ("position" <= 29))'),
    ),
    envelope("visit_prescription_items", "medicine_enc"),
    envelope("visit_prescription_items", "dose_enc"),
    envelope("visit_prescription_items", "frequency_enc"),
    envelope("visit_prescription_items", "duration_enc"),
    envelope("visit_prescription_items", "note_enc"),
  ],
);
