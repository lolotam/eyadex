import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { clinics } from "./clinics.ts";
import { tz } from "./finance-columns.ts";

// The key of 0068 (finance F3 spec §7.3, pipeline §4): built from the blob row itself, in either format.
const BLOB_KEY =
  "((((('clinic/'::text || (clinic_id)::text) || '/finance-exports/'::text) || (export_id)::text) || '/'::text) || (attempt)::text)";

const REPORTS = [
  "daily_takings",
  "period_summary",
  "by_service",
  "by_doctor",
  "outstanding",
  "patient_credit",
  "refunds",
  "discounts",
  "cash_closings",
  "own_summary",
] as const;
const EXPORT_STATUSES = ["queued", "running", "done", "failed", "expired", "purged"] as const;
const BLOB_STATES = ["allocated", "uploaded", "published", "deleted", "gone"] as const;
const anyOf = (column: string, values: readonly string[]) =>
  `(${column} = ANY (ARRAY[${values.map((v) => `'${v}'::text`).join(", ")}]))`;

export const financeReportExports = pgTable(
  "finance_report_exports",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    // A membership id with no foreign key (as payments.received_by).
    requestedBy: uuid("requested_by").notNull(),
    report: text("report", { enum: REPORTS }).notNull(),
    params: jsonb("params").notNull(),
    format: text("format", { enum: ["csv", "xlsx"] }).notNull(),
    scope: text("scope", { enum: ["clinic", "branch", "own"] }).notNull(),
    // The patients of an `own` export only, cleared when the file expires (EY-10.4, EY-10.6).
    patientIds: uuid("patient_ids").array(),
    patientSetMode: text("patient_set_mode", { enum: ["array", "ledger"] })
      .notNull()
      .default(sql`'array'::text`),
    status: text("status", { enum: EXPORT_STATUSES })
      .notNull()
      .default(sql`'queued'::text`),
    attempt: integer("attempt").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseUntil: timestamp("lease_until", tz),
    nextAttemptAt: timestamp("next_attempt_at", tz),
    storageKey: text("storage_key"),
    byteSize: bigint("byte_size", { mode: "number" }),
    rowCount: bigint("row_count", { mode: "number" }),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", tz).notNull(),
    startedAt: timestamp("started_at", tz),
    finishedAt: timestamp("finished_at", tz),
    expiresAt: timestamp("expires_at", tz),
  },
  (t) => [
    primaryKey({ name: "finance_report_exports_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "finance_report_exports_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    index("finance_report_exports_requester_idx").on(t.clinicId, t.requestedBy, t.createdAt),
    // Pipeline §2 step 3: at most one running export per member.
    uniqueIndex("finance_report_exports_one_running_idx")
      .on(t.clinicId, t.requestedBy)
      .where(sql.raw("status = 'running'::text")),
    index("finance_report_exports_expiry_idx").on(t.clinicId, t.status, t.expiresAt),
    check(
      "finance_report_exports_patient_set_mode_check",
      sql.raw(anyOf("patient_set_mode", ["array", "ledger"])),
    ),
    check("finance_report_exports_attempt_check", sql.raw("(attempt >= 0)")),
    check("finance_report_exports_byte_size_check", sql.raw("(byte_size > 0)")),
    check("finance_report_exports_format_check", sql.raw(anyOf("format", ["csv", "xlsx"]))),
    check(
      "finance_report_exports_params_check",
      sql.raw("(jsonb_typeof(params) = 'object'::text)"),
    ),
    check(
      "finance_report_exports_patient_ids_own_check",
      sql.raw("((patient_ids IS NULL) OR (scope = 'own'::text))"),
    ),
    check("finance_report_exports_report_check", sql.raw(anyOf("report", REPORTS))),
    check("finance_report_exports_row_count_check", sql.raw("(row_count >= 0)")),
    check(
      "finance_report_exports_scope_check",
      sql.raw(anyOf("scope", ["clinic", "branch", "own"])),
    ),
    check("finance_report_exports_status_check", sql.raw(anyOf("status", EXPORT_STATUSES))),
    check(
      "finance_report_exports_storage_key_check",
      sql.raw(
        "(storage_key = ((((((('clinic/'::text || (clinic_id)::text) || '/finance-exports/'::text) || (id)::text) || '/'::text) || (attempt)::text) || '.'::text) || format))",
      ),
    ),
  ],
);

export const financeReportExportBlobs = pgTable(
  "finance_report_export_blobs",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    exportId: uuid("export_id").notNull(),
    attempt: integer("attempt").notNull(),
    storageKey: text("storage_key").notNull(),
    state: text("state", { enum: BLOB_STATES }).notNull(),
    deletedAt: timestamp("deleted_at", tz),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "finance_report_export_blobs_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "finance_report_export_blobs_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "finance_report_export_blobs_clinic_id_export_id_fkey",
      columns: [t.clinicId, t.exportId],
      foreignColumns: [financeReportExports.clinicId, financeReportExports.id],
    }),
    // One row per key ever allocated (pipeline §6).
    unique("finance_report_export_blobs_attempt_unique").on(t.clinicId, t.exportId, t.attempt),
    index("finance_report_export_blobs_sweep_idx").on(t.clinicId, t.state, t.updatedAt),
    check("finance_report_export_blobs_attempt_check", sql.raw("(attempt >= 1)")),
    check(
      "finance_report_export_blobs_deleted_at_check",
      sql.raw(`((deleted_at IS NOT NULL) = ${anyOf("state", ["deleted", "gone"])})`),
    ),
    check("finance_report_export_blobs_state_check", sql.raw(anyOf("state", BLOB_STATES))),
    check(
      "finance_report_export_blobs_storage_key_check",
      sql.raw(
        `((storage_key = (${BLOB_KEY} || '.csv'::text)) OR (storage_key = (${BLOB_KEY} || '.xlsx'::text)))`,
      ),
    ),
  ],
);

/** Spec §5.2: what each invoice is paid and owes, derived under the caller's RLS (0068, security_invoker). */
export const financeInvoiceBalances = pgView("finance_invoice_balances", {
  clinicId: uuid("clinic_id"),
  id: uuid("id"),
  branchId: uuid("branch_id"),
  patientId: uuid("patient_id"),
  status: text("status"),
  issuedAt: timestamp("issued_at", tz),
  businessDate: date("business_date", { mode: "string" }),
  totalMinor: bigint("total_minor", { mode: "bigint" }),
  paidMinor: bigint("paid_minor", { mode: "bigint" }),
  owedMinor: bigint("owed_minor", { mode: "bigint" }),
  currency: char("currency", { length: 3 }),
}).existing();
