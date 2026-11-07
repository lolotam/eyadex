import { sql } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { clinics } from "./clinics.ts";
import { invoicePdfJobs } from "./invoice-pdf-jobs.ts";
import { invoicePdfUploadAttempts } from "./invoice-pdf-upload-attempts.ts";

// Catalog mirror of the local-only PDF ledger candidate. SQL remains authoritative.

export const invoicePdfArtifacts = pg.pgTable(
  "invoice_pdf_artifacts",
  {
    clinicId: pg.uuid("clinic_id").notNull(),
    id: pg.uuid("id").notNull(),
    jobId: pg.uuid("job_id").notNull(),
    uploadId: pg.uuid("upload_id").notNull(),
    state: pg.text("state").notNull(),
    cipherKeyVersion: pg.integer("cipher_key_version").notNull(),
    byteLength: pg.bigint("byte_length", { mode: "bigint" }).notNull(),
    publishedAt: pg.timestamp("published_at", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: pg.timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    deletedAt: pg.timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    pg.check(
      "invoice_pdf_artifacts_byte_length_check",
      sql.raw("((byte_length >= 1) AND (byte_length <= 5242880))"),
    ),
    pg.check(
      "invoice_pdf_artifacts_check",
      sql.raw("(expires_at = (published_at + '24:00:00'::interval))"),
    ),
    pg.check(
      "invoice_pdf_artifacts_check1",
      sql.raw("((state <> 'deleted'::text) OR (deleted_at IS NOT NULL))"),
    ),
    pg.check("invoice_pdf_artifacts_cipher_key_version_check", sql.raw("(cipher_key_version > 0)")),
    pg
      .foreignKey({
        name: "invoice_pdf_artifacts_clinic_id_fkey",
        columns: [t.clinicId],
        foreignColumns: [clinics.id],
      })
      .onDelete("restrict"),
    pg
      .foreignKey({
        name: "invoice_pdf_artifacts_clinic_id_job_id_fkey",
        columns: [t.clinicId, t.jobId],
        foreignColumns: [invoicePdfJobs.clinicId, invoicePdfJobs.id],
      })
      .onDelete("restrict"),
    pg
      .foreignKey({
        name: "invoice_pdf_artifacts_clinic_id_job_id_upload_id_fkey",
        columns: [t.clinicId, t.jobId, t.uploadId],
        foreignColumns: [
          invoicePdfUploadAttempts.clinicId,
          invoicePdfUploadAttempts.jobId,
          invoicePdfUploadAttempts.id,
        ],
      })
      .onDelete("restrict"),
    pg.primaryKey({ name: "invoice_pdf_artifacts_pkey", columns: [t.clinicId, t.id] }),
    pg.check(
      "invoice_pdf_artifacts_state_check",
      sql.raw(
        "(state = ANY (ARRAY['ready'::text, 'expired'::text, 'deleting'::text, 'deleted'::text]))",
      ),
    ),
    pg
      .uniqueIndex("invoice_pdf_artifacts_clinic_id_upload_id_key")
      .on(sql.raw("clinic_id, upload_id")),
    pg
      .uniqueIndex("invoice_pdf_one_ready")
      .on(sql.raw("clinic_id, job_id"))
      .where(sql.raw("state = 'ready'::text")),
    pg.index("invoice_pdf_artifact_expiry").on(sql.raw("clinic_id, state, expires_at")),
    pg.index("invoice_pdf_artifact_attempt").on(sql.raw("clinic_id, job_id, upload_id")),
    pg
      .index("invoice_pdf_artifact_purge")
      .on(sql.raw("clinic_id, deleted_at"))
      .where(sql.raw("state = 'deleted'::text")),
  ],
);
