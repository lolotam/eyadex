import { sql } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { clinics } from "./clinics.ts";
import { invoicePdfJobs } from "./invoice-pdf-jobs.ts";

// Catalog mirror of the local-only PDF ledger candidate. SQL remains authoritative.

export const invoicePdfUploadAttempts = pg.pgTable(
  "invoice_pdf_upload_attempts",
  {
    clinicId: pg.uuid("clinic_id").notNull(),
    id: pg.uuid("id").notNull(),
    jobId: pg.uuid("job_id").notNull(),
    attempt: pg.integer("attempt").notNull(),
    fence: pg.bigint("fence", { mode: "bigint" }).notNull(),
    state: pg.text("state").notNull(),
    storageKey: pg.text("storage_key").notNull(),
    uploadDeadlineAt: pg
      .timestamp("upload_deadline_at", { withTimezone: true, mode: "date" })
      .notNull(),
    writerStoppedAt: pg.timestamp("writer_stopped_at", { withTimezone: true, mode: "date" }),
    cleanupDueAt: pg.timestamp("cleanup_due_at", { withTimezone: true, mode: "date" }),
    deletedAt: pg.timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    terminalAt: pg.timestamp("terminal_at", { withTimezone: true, mode: "date" }),
    createdAt: pg.timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: pg.timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [
    pg.check("invoice_pdf_upload_attempts_attempt_check", sql.raw("(attempt > 0)")),
    pg.check(
      "invoice_pdf_upload_attempts_check",
      sql.raw(
        "(storage_key = ((((('clinic/'::text || (clinic_id)::text) || '/invoice-pdfs/'::text) || (job_id)::text) || '/'::text) || (id)::text))",
      ),
    ),
    pg.check(
      "invoice_pdf_upload_attempts_check1",
      sql.raw("((state <> 'deleted'::text) OR (deleted_at IS NOT NULL))"),
    ),
    pg.check(
      "invoice_pdf_upload_attempts_check2",
      sql.raw(
        "((state <> ALL (ARRAY['deleting'::text, 'deleted'::text])) OR (writer_stopped_at IS NOT NULL))",
      ),
    ),
    pg
      .foreignKey({
        name: "invoice_pdf_upload_attempts_clinic_id_fkey",
        columns: [t.clinicId],
        foreignColumns: [clinics.id],
      })
      .onDelete("restrict"),
    pg
      .foreignKey({
        name: "invoice_pdf_upload_attempts_clinic_id_job_id_fkey",
        columns: [t.clinicId, t.jobId],
        foreignColumns: [invoicePdfJobs.clinicId, invoicePdfJobs.id],
      })
      .onDelete("restrict"),
    pg.check("invoice_pdf_upload_attempts_fence_check", sql.raw("(fence > 0)")),
    pg.primaryKey({ name: "invoice_pdf_upload_attempts_pkey", columns: [t.clinicId, t.id] }),
    pg.check(
      "invoice_pdf_upload_attempts_state_check",
      sql.raw(
        "(state = ANY (ARRAY['allocated'::text, 'unknown'::text, 'uploaded'::text, 'published'::text, 'deleting'::text, 'deleted'::text]))",
      ),
    ),
    pg
      .uniqueIndex("invoice_pdf_upload_attempts_clinic_id_job_id_attempt_key")
      .on(sql.raw("clinic_id, job_id, attempt")),
    pg
      .uniqueIndex("invoice_pdf_upload_attempts_clinic_id_job_id_id_key")
      .on(sql.raw("clinic_id, job_id, id")),
    pg
      .uniqueIndex("invoice_pdf_upload_attempts_clinic_id_storage_key_key")
      .on(sql.raw("clinic_id, storage_key")),
    pg.index("invoice_pdf_upload_cleanup").on(sql.raw("clinic_id, state, cleanup_due_at")),
    pg
      .index("invoice_pdf_upload_purge")
      .on(sql.raw("clinic_id, deleted_at, terminal_at"))
      .where(sql.raw("state = 'deleted'::text")),
  ],
);
