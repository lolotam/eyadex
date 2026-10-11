import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { clinics } from "./clinics.ts";
import { visits } from "./medical.ts";
import { patients } from "./patients.ts";

// Mirror of db/sql/0049 (P2 spec §4, §6). A clinic table: forced RLS, eyadex_app only, archived never
// deleted. The bytes live in the blob store, sealed by the API; `name_enc` is a FieldCipher envelope
// (ADR-0028); `uploaded_by` is a membership id with no foreign key (ADR-0027).
const tz = { withTimezone: true, mode: "date" } as const;

export const patientAttachments = pgTable(
  "patient_attachments",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    patientId: uuid("patient_id").notNull(),
    visitId: uuid("visit_id"),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type", {
      enum: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    nameEnc: text("name_enc").notNull(),
    status: text("status", { enum: ["active", "archived"] }).notNull(),
    uploadedBy: uuid("uploaded_by").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "patient_attachments_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "patient_attachments_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "patient_attachments_clinic_id_patient_id_fkey",
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
    foreignKey({
      name: "patient_attachments_clinic_id_visit_id_fkey",
      columns: [t.clinicId, t.visitId],
      foreignColumns: [visits.clinicId, visits.id],
    }),
    index("patient_attachments_clinic_patient_created_idx").on(
      t.clinicId,
      t.patientId,
      t.createdAt.desc().nullsFirst(),
    ),
    index("patient_attachments_clinic_visit_idx").on(t.clinicId, t.visitId),
    check(
      "patient_attachments_content_type_check",
      sql.raw(
        "(content_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text, 'application/pdf'::text]))",
      ),
    ),
    check(
      "patient_attachments_size_bytes_check",
      sql.raw("((size_bytes > 0) AND (size_bytes <= 20971520))"),
    ),
    check("patient_attachments_sha256_check", sql.raw("(sha256 ~ '^[0-9a-f]{64}$'::text)")),
    check("patient_attachments_name_enc_check", sql.raw("(name_enc ~ '^f1\\.[0-9]+\\.'::text)")),
    check(
      "patient_attachments_status_check",
      sql.raw("(status = ANY (ARRAY['active'::text, 'archived'::text]))"),
    ),
    check(
      "patient_attachments_storage_key_check",
      sql.raw("(storage_key = ((('clinic/'::text || clinic_id) || '/'::text) || id))"),
    ),
  ],
);
