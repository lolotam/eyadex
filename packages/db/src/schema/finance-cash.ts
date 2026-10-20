import { sql } from "drizzle-orm";
import {
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { branches } from "./branches.ts";
import { clinics } from "./clinics.ts";
import { invoices } from "./finance-invoices.ts";
import { EXPONENT_FOLLOWS_CURRENCY, patientCredits } from "./finance-payments.ts";
import { patients } from "./patients.ts";
import { CURRENCIES, minor, tz } from "./finance-columns.ts";

// Mirror of db/sql/0064 (finance spec §4.2, ADR-0034): append-only money rows; only the counters and the
// methods row are updated.

export const refunds = pgTable(
  "refunds",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    year: smallint("year").notNull(),
    refundSeq: integer("refund_seq").notNull(),
    refundNumber: text("refund_number").notNull(),
    method: text("method", { enum: ["cash", "knet", "bank_transfer", "other"] }).notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    currencyExponent: smallint("currency_exponent").notNull(),
    reason: text("reason").notNull(),
    refundedAt: timestamp("refunded_at", tz).notNull(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    cashSeq: minor("cash_seq"),
    // A membership id with no foreign key (ADR-0027, as invoices.created_by).
    refundedBy: uuid("refunded_by").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "refunds_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "refunds_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "refunds_clinic_id_branch_id_fkey",
      columns: [t.clinicId, t.branchId],
      foreignColumns: [branches.clinicId, branches.id],
    }),
    foreignKey({
      name: "refunds_clinic_id_patient_id_fkey",
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
    foreignKey({
      name: "refunds_invoice_fkey",
      columns: [t.clinicId, t.invoiceId, t.branchId, t.patientId, t.currency],
      foreignColumns: [
        invoices.clinicId,
        invoices.id,
        invoices.branchId,
        invoices.patientId,
        invoices.currency,
      ],
    }),
    unique("refunds_refund_number_unique").on(t.clinicId, t.refundNumber),
    unique("refunds_refund_seq_unique").on(t.clinicId, t.branchId, t.year, t.refundSeq),
    unique("refunds_cash_seq_unique").on(t.clinicId, t.branchId, t.cashSeq),
    unique("refunds_id_patient_unique").on(t.clinicId, t.id, t.patientId),
    index("refunds_invoice_idx").on(t.clinicId, t.invoiceId, t.branchId, t.patientId, t.currency),
    index("refunds_clinic_patient_idx").on(t.clinicId, t.patientId),
    index("refunds_clinic_branch_date_idx").on(t.clinicId, t.branchId, t.businessDate),
    check("refunds_amount_minor_check", sql.raw("(amount_minor > 0)")),
    check("refunds_cash_seq_check", sql.raw("(cash_seq >= 1)")),
    check(
      "refunds_cash_seq_method_check",
      sql.raw("((method = 'cash'::text) = (cash_seq IS NOT NULL))"),
    ),
    check("refunds_currency_check", sql.raw(`${CURRENCIES}`)),
    check("refunds_currency_exponent_check", sql.raw("(currency_exponent = ANY (ARRAY[2, 3]))")),
    check("refunds_currency_exponent_match_check", sql.raw(EXPONENT_FOLLOWS_CURRENCY)),
    check(
      "refunds_method_check",
      sql.raw(
        "(method = ANY (ARRAY['cash'::text, 'knet'::text, 'bank_transfer'::text, 'other'::text]))",
      ),
    ),
    check("refunds_reason_check", sql.raw("((length(reason) >= 1) AND (length(reason) <= 300))")),
    check("refunds_refund_seq_check", sql.raw("(refund_seq >= 1)")),
    check("refunds_year_check", sql.raw("((year >= 2000) AND (year <= 9999))")),
  ],
);

export const refundSources = pgTable(
  "refund_sources",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    refundId: uuid("refund_id").notNull(),
    creditId: uuid("credit_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "refund_sources_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "refund_sources_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "refund_sources_clinic_id_patient_id_fkey",
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
    foreignKey({
      name: "refund_sources_clinic_id_refund_id_patient_id_fkey",
      columns: [t.clinicId, t.refundId, t.patientId],
      foreignColumns: [refunds.clinicId, refunds.id, refunds.patientId],
    }),
    foreignKey({
      name: "refund_sources_clinic_id_credit_id_patient_id_fkey",
      columns: [t.clinicId, t.creditId, t.patientId],
      foreignColumns: [patientCredits.clinicId, patientCredits.id, patientCredits.patientId],
    }),
    unique("refund_sources_refund_credit_unique").on(t.clinicId, t.refundId, t.creditId),
    index("refund_sources_clinic_refund_patient_idx").on(t.clinicId, t.refundId, t.patientId),
    index("refund_sources_clinic_credit_patient_idx").on(t.clinicId, t.creditId, t.patientId),
    index("refund_sources_clinic_patient_idx").on(t.clinicId, t.patientId),
    check("refund_sources_amount_minor_check", sql.raw("(amount_minor > 0)")),
  ],
);

export const cashClosings = pgTable(
  "cash_closings",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    branchId: uuid("branch_id").notNull(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    fromCashSeq: minor("from_cash_seq").notNull(),
    toCashSeq: minor("to_cash_seq").notNull(),
    expectedMinor: minor("expected_minor").notNull(),
    countedMinor: minor("counted_minor").notNull(),
    // The difference is computed, never written (spec §4.2, R3-5).
    differenceMinor: minor("difference_minor").generatedAlwaysAs(
      sql`counted_minor - expected_minor`,
    ),
    methodTotals: jsonb("method_totals").notNull(),
    note: text("note"),
    previousClosingId: uuid("previous_closing_id"),
    currency: char("currency", { length: 3 }).notNull(),
    currencyExponent: smallint("currency_exponent").notNull(),
    // A membership id with no foreign key (ADR-0027, as invoices.created_by).
    closedBy: uuid("closed_by").notNull(),
    closedAt: timestamp("closed_at", tz).notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "cash_closings_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "cash_closings_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "cash_closings_clinic_id_branch_id_fkey",
      columns: [t.clinicId, t.branchId],
      foreignColumns: [branches.clinicId, branches.id],
    }),
    // The chain of a branch's closings stays inside that branch (R3-3).
    foreignKey({
      name: "cash_closings_clinic_id_branch_id_previous_closing_id_fkey",
      columns: [t.clinicId, t.branchId, t.previousClosingId],
      foreignColumns: [t.clinicId, t.branchId, t.id],
    }),
    unique("cash_closings_branch_id_unique").on(t.clinicId, t.branchId, t.id),
    unique("cash_closings_business_date_unique").on(t.clinicId, t.branchId, t.businessDate),
    unique("cash_closings_chain_unique")
      .on(t.clinicId, t.branchId, t.previousClosingId)
      .nullsNotDistinct(),
    index("cash_closings_clinic_branch_closed_idx").on(t.clinicId, t.branchId, t.closedAt),
    check(
      "cash_closings_counted_minor_check",
      sql.raw("((counted_minor >= 0) AND (counted_minor <= '1000000000000000000'::bigint))"),
    ),
    check("cash_closings_currency_check", sql.raw(`${CURRENCIES}`)),
    check(
      "cash_closings_currency_exponent_check",
      sql.raw("(currency_exponent = ANY (ARRAY[2, 3]))"),
    ),
    check("cash_closings_currency_exponent_match_check", sql.raw(EXPONENT_FOLLOWS_CURRENCY)),
    check(
      "cash_closings_difference_note_check",
      sql.raw("((counted_minor = expected_minor) OR (note IS NOT NULL))"),
    ),
    check(
      "cash_closings_expected_minor_check",
      sql.raw(
        "((expected_minor >= '-1000000000000000000'::bigint) AND (expected_minor <= '1000000000000000000'::bigint))",
      ),
    ),
    check("cash_closings_from_cash_seq_check", sql.raw("(from_cash_seq >= 0)")),
    check(
      "cash_closings_method_totals_check",
      sql.raw("(jsonb_typeof(method_totals) = 'array'::text)"),
    ),
    check("cash_closings_note_check", sql.raw("((length(note) >= 1) AND (length(note) <= 300))")),
    check("cash_closings_period_check", sql.raw("(to_cash_seq >= from_cash_seq)")),
  ],
);

export const branchCashDrawers = pgTable(
  "branch_cash_drawers",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    branchId: uuid("branch_id").notNull(),
    lastCashSeq: minor("last_cash_seq").notNull(),
    lastClosedSeq: minor("last_closed_seq").notNull(),
    lastClosingId: uuid("last_closing_id"),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "branch_cash_drawers_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "branch_cash_drawers_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "branch_cash_drawers_clinic_id_branch_id_fkey",
      columns: [t.clinicId, t.branchId],
      foreignColumns: [branches.clinicId, branches.id],
    }),
    // The drawer names a closing of its own branch.
    foreignKey({
      name: "branch_cash_drawers_clinic_id_branch_id_last_closing_id_fkey",
      columns: [t.clinicId, t.branchId, t.lastClosingId],
      foreignColumns: [cashClosings.clinicId, cashClosings.branchId, cashClosings.id],
    }),
    unique("branch_cash_drawers_branch_unique").on(t.clinicId, t.branchId),
    index("branch_cash_drawers_clinic_branch_closing_idx").on(
      t.clinicId,
      t.branchId,
      t.lastClosingId,
    ),
    check("branch_cash_drawers_closed_check", sql.raw("(last_closed_seq <= last_cash_seq)")),
    check(
      "branch_cash_drawers_first_closing_check",
      sql.raw("((last_closing_id IS NOT NULL) OR (last_closed_seq = 0))"),
    ),
    check("branch_cash_drawers_last_cash_seq_check", sql.raw("(last_cash_seq >= 0)")),
    check("branch_cash_drawers_last_closed_seq_check", sql.raw("(last_closed_seq >= 0)")),
  ],
);
