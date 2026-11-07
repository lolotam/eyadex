import { sql } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { clinics } from "./clinics.ts";
import { invoices } from "./finance-invoices.ts";

// Catalog mirror of the local-only PDF ledger candidate. SQL remains authoritative.

export const invoicePdfJobs = pg.pgTable(
  "invoice_pdf_jobs",
  {
    clinicId: pg.uuid("clinic_id").notNull(),
    id: pg.uuid("id").notNull(),
    invoiceId: pg.uuid("invoice_id").notNull(),
    invoiceVersion: pg.integer("invoice_version").notNull(),
    renderRevision: pg.varchar("render_revision", { length: 256 }).notNull(),
    status: pg.text("status").notNull().default(sql.raw("'queued'::text")),
    attempt: pg.integer("attempt").notNull().default(sql.raw("0")),
    retryCount: pg.integer("retry_count").notNull().default(sql.raw("0")),
    fence: pg.bigint("fence", { mode: "bigint" }).notNull().default(sql.raw("0")),
    leaseToken: pg.uuid("lease_token"),
    leaseUntil: pg.timestamp("lease_until", { withTimezone: true, mode: "date" }),
    deadlineAt: pg.timestamp("deadline_at", { withTimezone: true, mode: "date" }),
    nextAttemptAt: pg.timestamp("next_attempt_at", { withTimezone: true, mode: "date" }),
    clinicSlot: pg.smallint("clinic_slot"),
    readyUntil: pg.timestamp("ready_until", { withTimezone: true, mode: "date" }),
    cleanupDueAt: pg.timestamp("cleanup_due_at", { withTimezone: true, mode: "date" }),
    errorCode: pg.text("error_code"),
    createdAt: pg.timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: pg.timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [
    pg.check("invoice_pdf_jobs_attempt_check", sql.raw("((attempt >= 0) AND (attempt <= 3))")),
    pg.check(
      "invoice_pdf_jobs_check",
      sql.raw(
        "((status = ANY (ARRAY['queued'::text, 'running'::text, 'retry_wait'::text])) = (clinic_slot IS NOT NULL))",
      ),
    ),
    pg.check(
      "invoice_pdf_jobs_check1",
      sql.raw(
        "((status = 'running'::text) = ((lease_token IS NOT NULL) AND (lease_until IS NOT NULL) AND (deadline_at IS NOT NULL)))",
      ),
    ),
    pg.check("invoice_pdf_jobs_check2", sql.raw("((lease_token IS NULL) = (lease_until IS NULL))")),
    pg.check("invoice_pdf_jobs_check3", sql.raw("((lease_token IS NULL) = (deadline_at IS NULL))")),
    pg.check(
      "invoice_pdf_jobs_check4",
      sql.raw("((status = 'retry_wait'::text) = (next_attempt_at IS NOT NULL))"),
    ),
    pg.check(
      "invoice_pdf_jobs_check5",
      sql.raw(
        "((status <> 'running'::text) OR ((attempt > 0) AND (fence > 0) AND (lease_until <= deadline_at)))",
      ),
    ),
    pg.check(
      "invoice_pdf_jobs_check6",
      sql.raw("((status = 'ready'::text) = (ready_until IS NOT NULL))"),
    ),
    pg
      .foreignKey({
        name: "invoice_pdf_jobs_clinic_id_fkey",
        columns: [t.clinicId],
        foreignColumns: [clinics.id],
      })
      .onDelete("restrict"),
    pg
      .foreignKey({
        name: "invoice_pdf_jobs_clinic_id_invoice_id_fkey",
        columns: [t.clinicId, t.invoiceId],
        foreignColumns: [invoices.clinicId, invoices.id],
      })
      .onDelete("restrict"),
    pg.check(
      "invoice_pdf_jobs_clinic_slot_check",
      sql.raw("((clinic_slot >= 1) AND (clinic_slot <= 10))"),
    ),
    pg.check(
      "invoice_pdf_jobs_error_code_check",
      sql.raw(
        "(error_code = ANY (ARRAY['store_unavailable'::text, 'db_unavailable'::text, 'lease_expired'::text, 'invalid_model'::text, 'size_limit'::text, 'cancelled'::text, 'superseded'::text]))",
      ),
    ),
    pg.check("invoice_pdf_jobs_fence_check", sql.raw("(fence >= 0)")),
    pg.check("invoice_pdf_jobs_invoice_version_check", sql.raw("(invoice_version > 0)")),
    pg.primaryKey({ name: "invoice_pdf_jobs_pkey", columns: [t.clinicId, t.id] }),
    pg.check(
      "invoice_pdf_jobs_render_revision_check",
      sql.raw(
        "((render_revision)::text ~ '^[A-Za-z0-9_.-]+:[1-9][0-9]*:[1-9][0-9]*:[1-9][0-9]*$'::text)",
      ),
    ),
    pg.check(
      "invoice_pdf_jobs_retry_count_check",
      sql.raw("((retry_count >= 0) AND (retry_count <= 2))"),
    ),
    pg.check(
      "invoice_pdf_jobs_status_check",
      sql.raw(
        "(status = ANY (ARRAY['queued'::text, 'running'::text, 'retry_wait'::text, 'ready'::text, 'failed'::text, 'cancelled'::text, 'superseded'::text, 'expired'::text]))",
      ),
    ),
    pg
      .uniqueIndex("invoice_pdf_current_generation")
      .on(sql.raw("clinic_id, invoice_id, invoice_version, render_revision"))
      .where(
        sql.raw(
          "status = ANY (ARRAY['queued'::text, 'running'::text, 'retry_wait'::text, 'ready'::text])",
        ),
      ),
    pg
      .uniqueIndex("invoice_pdf_clinic_capacity")
      .on(sql.raw("clinic_id, clinic_slot"))
      .where(sql.raw("clinic_slot IS NOT NULL")),
    pg.index("invoice_pdf_invoice").on(sql.raw("clinic_id, invoice_id")),
    pg.index("invoice_pdf_due").on(sql.raw("clinic_id, status, next_attempt_at, created_at")),
    pg.index("invoice_pdf_cleanup").on(sql.raw("clinic_id, cleanup_due_at")),
    pg
      .index("invoice_pdf_job_purge")
      .on(sql.raw("clinic_id, updated_at"))
      .where(
        sql.raw(
          "status = ANY (ARRAY['failed'::text, 'cancelled'::text, 'superseded'::text, 'expired'::text])",
        ),
      ),
  ],
);
