import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

import { branches } from "./branches.ts";
import { clinics } from "./clinics.ts";
import { invoices } from "./finance-invoices.ts";
import { patients } from "./patients.ts";
import { CURRENCIES, minor, tz } from "./finance-columns.ts";

// Mirror of db/sql/0064 (finance spec §4.2, ADR-0034): append-only money rows; only the counters and the
// methods row are updated.

/** PostgreSQL prints this CASE over several lines; the mirror keeps its exact text (as clinics.ts does). */
export const EXPONENT_FOLLOWS_CURRENCY =
  "(currency_exponent =\nCASE\n    WHEN (currency = ANY (ARRAY['KWD'::bpchar, 'BHD'::bpchar, 'OMR'::bpchar])) THEN 3\n    ELSE 2\nEND)";

export const clinicPaymentMethods = pgTable(
  "clinic_payment_methods",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    method: text("method", { enum: ["cash", "knet", "bank_transfer", "other"] }).notNull(),
    enabled: boolean("enabled").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "clinic_payment_methods_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "clinic_payment_methods_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    unique("clinic_payment_methods_method_unique").on(t.clinicId, t.method),
    check(
      "clinic_payment_methods_method_check",
      sql.raw(
        "(method = ANY (ARRAY['cash'::text, 'knet'::text, 'bank_transfer'::text, 'other'::text]))",
      ),
    ),
  ],
);

export const receiptSequences = pgTable(
  "receipt_sequences",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    branchId: uuid("branch_id").notNull(),
    series: text("series", { enum: ["receipt", "refund"] }).notNull(),
    year: smallint("year").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "receipt_sequences_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "receipt_sequences_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "receipt_sequences_clinic_id_branch_id_fkey",
      columns: [t.clinicId, t.branchId],
      foreignColumns: [branches.clinicId, branches.id],
    }),
    unique("receipt_sequences_branch_series_year_unique").on(
      t.clinicId,
      t.branchId,
      t.series,
      t.year,
    ),
    check("receipt_sequences_next_number_check", sql.raw("(next_number >= 1)")),
    check(
      "receipt_sequences_series_check",
      sql.raw("(series = ANY (ARRAY['receipt'::text, 'refund'::text]))"),
    ),
    check("receipt_sequences_year_check", sql.raw("((year >= 2000) AND (year <= 9999))")),
  ],
);

export const payments = pgTable(
  "payments",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    year: smallint("year").notNull(),
    receiptSeq: integer("receipt_seq").notNull(),
    receiptNumber: text("receipt_number").notNull(),
    method: text("method", { enum: ["cash", "knet", "bank_transfer", "other"] }).notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    currencyExponent: smallint("currency_exponent").notNull(),
    reference: text("reference"),
    receivedAt: timestamp("received_at", tz).notNull(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    cashSeq: minor("cash_seq"),
    // A membership id with no foreign key (ADR-0027, as invoices.created_by).
    receivedBy: uuid("received_by").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "payments_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "payments_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "payments_clinic_id_branch_id_fkey",
      columns: [t.clinicId, t.branchId],
      foreignColumns: [branches.clinicId, branches.id],
    }),
    foreignKey({
      name: "payments_clinic_id_patient_id_fkey",
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
    foreignKey({
      name: "payments_invoice_fkey",
      columns: [t.clinicId, t.invoiceId, t.branchId, t.patientId, t.currency],
      foreignColumns: [
        invoices.clinicId,
        invoices.id,
        invoices.branchId,
        invoices.patientId,
        invoices.currency,
      ],
    }),
    unique("payments_receipt_number_unique").on(t.clinicId, t.receiptNumber),
    unique("payments_receipt_seq_unique").on(t.clinicId, t.branchId, t.year, t.receiptSeq),
    unique("payments_cash_seq_unique").on(t.clinicId, t.branchId, t.cashSeq),
    unique("payments_allocation_target_unique").on(t.clinicId, t.id, t.invoiceId, t.patientId),
    index("payments_invoice_idx").on(t.clinicId, t.invoiceId, t.branchId, t.patientId, t.currency),
    index("payments_clinic_patient_idx").on(t.clinicId, t.patientId),
    index("payments_clinic_branch_date_idx").on(t.clinicId, t.branchId, t.businessDate),
    check("payments_amount_minor_check", sql.raw("(amount_minor > 0)")),
    check("payments_cash_seq_check", sql.raw("(cash_seq >= 1)")),
    check(
      "payments_cash_seq_method_check",
      sql.raw("((method = 'cash'::text) = (cash_seq IS NOT NULL))"),
    ),
    check("payments_currency_check", sql.raw(`${CURRENCIES}`)),
    check("payments_currency_exponent_check", sql.raw("(currency_exponent = ANY (ARRAY[2, 3]))")),
    check("payments_currency_exponent_match_check", sql.raw(EXPONENT_FOLLOWS_CURRENCY)),
    check(
      "payments_method_check",
      sql.raw(
        "(method = ANY (ARRAY['cash'::text, 'knet'::text, 'bank_transfer'::text, 'other'::text]))",
      ),
    ),
    check("payments_receipt_seq_check", sql.raw("(receipt_seq >= 1)")),
    check(
      "payments_reference_check",
      sql.raw("((length(reference) >= 1) AND (length(reference) <= 60))"),
    ),
    check("payments_year_check", sql.raw("((year >= 2000) AND (year <= 9999))")),
  ],
);

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    paymentId: uuid("payment_id"),
    creditId: uuid("credit_id"),
    amountMinor: minor("amount_minor").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    // Finance F3 (0068, EY-10.5): the frozen business day, nullable until the contract step (0072).
    businessDate: date("business_date", { mode: "string" }),
  },
  // The two tables reference each other; an explicit return type stops TypeScript inferring a cycle.
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: "payment_allocations_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "payment_allocations_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "payment_allocations_clinic_id_patient_id_fkey",
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
    foreignKey({
      name: "payment_allocations_clinic_id_invoice_id_patient_id_fkey",
      columns: [t.clinicId, t.invoiceId, t.patientId],
      foreignColumns: [invoices.clinicId, invoices.id, invoices.patientId],
    }),
    foreignKey({
      name: "payment_allocations_payment_fkey",
      columns: [t.clinicId, t.paymentId, t.invoiceId, t.patientId],
      foreignColumns: [payments.clinicId, payments.id, payments.invoiceId, payments.patientId],
    }),
    // The credit points back at this table; the table's config is built lazily, so the later table is fine.
    foreignKey({
      name: "payment_allocations_clinic_id_credit_id_patient_id_fkey",
      columns: [t.clinicId, t.creditId, t.patientId],
      foreignColumns: [patientCredits.clinicId, patientCredits.id, patientCredits.patientId],
    }),
    unique("payment_allocations_id_patient_unique").on(t.clinicId, t.id, t.patientId),
    index("payment_allocations_clinic_invoice_patient_idx").on(
      t.clinicId,
      t.invoiceId,
      t.patientId,
    ),
    index("payment_allocations_payment_idx").on(t.clinicId, t.paymentId, t.invoiceId, t.patientId),
    index("payment_allocations_clinic_credit_patient_idx").on(t.clinicId, t.creditId, t.patientId),
    index("payment_allocations_clinic_patient_idx").on(t.clinicId, t.patientId),
    check("payment_allocations_amount_minor_check", sql.raw("(amount_minor > 0)")),
    check("payment_allocations_source_check", sql.raw("(num_nonnulls(payment_id, credit_id) = 1)")),
  ],
);

export const patientCredits = pgTable(
  "patient_credits",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    patientId: uuid("patient_id").notNull(),
    originAllocationId: uuid("origin_allocation_id").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    cause: text("cause", { enum: ["invoice_edited", "invoice_voided", "refund"] }).notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: "patient_credits_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "patient_credits_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "patient_credits_clinic_id_patient_id_fkey",
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
    foreignKey({
      name: "patient_credits_clinic_id_origin_allocation_id_patient_id_fkey",
      columns: [t.clinicId, t.originAllocationId, t.patientId],
      foreignColumns: [
        paymentAllocations.clinicId,
        paymentAllocations.id,
        paymentAllocations.patientId,
      ],
    }),
    unique("patient_credits_id_patient_unique").on(t.clinicId, t.id, t.patientId),
    index("patient_credits_clinic_origin_patient_idx").on(
      t.clinicId,
      t.originAllocationId,
      t.patientId,
    ),
    index("patient_credits_clinic_patient_idx").on(t.clinicId, t.patientId),
    check("patient_credits_amount_minor_check", sql.raw("(amount_minor > 0)")),
    check(
      "patient_credits_cause_check",
      sql.raw(
        "(cause = ANY (ARRAY['invoice_edited'::text, 'invoice_voided'::text, 'refund'::text]))",
      ),
    ),
  ],
);
