import { sql } from "drizzle-orm";
import {
  char,
  check,
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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { branches } from "./branches.ts";
import { clinics } from "./clinics.ts";
import { memberships } from "./memberships.ts";
import { patientNotifications } from "./notifications.ts";
import { patients } from "./patients.ts";
import { clinicServices } from "./scheduling.ts";
import { atLeastZero, bytea, CURRENCIES, lineCap, minor, tz } from "./finance-columns.ts";

// Mirror of db/sql/0060 and 0062 (finance spec §3.2, R1, R2, C1). Clinic tables: forced RLS, eyadex_app
// only, never deleted except the doctor price list (configuration, replaced as a whole). Amounts are
// bigint minor units; a line is capped at 10¹², aggregates by the type.

export const invoices = pgTable(
  "invoices",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    branchId: uuid("branch_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    year: smallint("year").notNull(),
    numberSeq: integer("number_seq").notNull(),
    number: text("number").notNull(),
    status: text("status", { enum: ["issued", "void"] }).notNull(),
    source: text("source", { enum: ["appointment", "visit", "manual"] }).notNull(),
    // An appointment or a visit, by source: no foreign key (the use case checks it).
    sourceId: uuid("source_id"),
    issuedAt: timestamp("issued_at", tz).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    currencyExponent: smallint("currency_exponent").notNull(),
    subtotalMinor: minor("subtotal_minor").notNull(),
    discountMinor: minor("discount_minor").notNull(),
    taxRateBp: integer("tax_rate_bp").notNull(),
    taxMinor: minor("tax_minor").notNull(),
    totalMinor: minor("total_minor").notNull(),
    invoiceDiscount: jsonb("invoice_discount"),
    voidReason: text("void_reason"),
    voidedAt: timestamp("voided_at", tz),
    version: integer("version").notNull().default(1),
    // A membership id with no foreign key (ADR-0027, as appointments.created_by).
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "invoices_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "invoices_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "invoices_clinic_id_branch_id_fkey",
      columns: [t.clinicId, t.branchId],
      foreignColumns: [branches.clinicId, branches.id],
    }),
    foreignKey({
      name: "invoices_clinic_id_patient_id_fkey",
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
    unique("invoices_number_unique").on(t.clinicId, t.number),
    // 0064: the money rows reach the invoice through a key that carries the patient.
    unique("invoices_id_patient_unique").on(t.clinicId, t.id, t.patientId),
    uniqueIndex("invoices_clinic_source_live")
      .on(t.clinicId, t.source, t.sourceId)
      .where(sql.raw("status <> 'void'::text")),
    index("invoices_clinic_branch_issued_idx").on(t.clinicId, t.branchId, t.issuedAt),
    index("invoices_clinic_patient_idx").on(t.clinicId, t.patientId),
    check("invoices_currency_check", sql.raw(`${CURRENCIES}`)),
    check("invoices_currency_exponent_check", sql.raw("(currency_exponent = ANY (ARRAY[2, 3]))")),
    atLeastZero("invoices", "discount_minor"),
    check("invoices_number_seq_check", sql.raw("(number_seq >= 1)")),
    check(
      "invoices_source_check",
      sql.raw("(source = ANY (ARRAY['appointment'::text, 'visit'::text, 'manual'::text]))"),
    ),
    check("invoices_source_id_check", sql.raw("((source = 'manual'::text) = (source_id IS NULL))")),
    check("invoices_status_check", sql.raw("(status = ANY (ARRAY['issued'::text, 'void'::text]))")),
    atLeastZero("invoices", "subtotal_minor"),
    atLeastZero("invoices", "tax_minor"),
    check("invoices_tax_rate_bp_check", sql.raw("((tax_rate_bp >= 0) AND (tax_rate_bp <= 10000))")),
    atLeastZero("invoices", "total_minor"),
    check("invoices_version_check", sql.raw("(version >= 1)")),
    check(
      "invoices_void_check",
      sql.raw(
        "(((status = 'void'::text) = ((voided_at IS NOT NULL) AND (void_reason IS NOT NULL))) AND ((voided_at IS NULL) = (void_reason IS NULL)))",
      ),
    ),
    check(
      "invoices_void_reason_check",
      sql.raw("((length(void_reason) >= 1) AND (length(void_reason) <= 300))"),
    ),
    check("invoices_year_check", sql.raw("((year >= 2000) AND (year <= 9999))")),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    position: smallint("position").notNull(),
    kind: text("kind", { enum: ["service", "free"] }).notNull(),
    serviceId: uuid("service_id"),
    providerId: uuid("provider_id"),
    descriptionAr: text("description_ar").notNull(),
    descriptionEn: text("description_en").notNull(),
    quantity: smallint("quantity").notNull(),
    unitPriceMinor: minor("unit_price_minor").notNull(),
    lineDiscount: jsonb("line_discount"),
    lineTotalMinor: minor("line_total_minor").notNull(),
    // A line removed by an edit is archived, never deleted; archiving frees its position.
    archivedAt: timestamp("archived_at", tz),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "invoice_lines_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "invoice_lines_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "invoice_lines_clinic_id_invoice_id_fkey",
      columns: [t.clinicId, t.invoiceId],
      foreignColumns: [invoices.clinicId, invoices.id],
    }),
    foreignKey({
      name: "invoice_lines_clinic_id_service_id_fkey",
      columns: [t.clinicId, t.serviceId],
      foreignColumns: [clinicServices.clinicId, clinicServices.id],
    }),
    foreignKey({
      name: "invoice_lines_clinic_id_provider_id_fkey",
      columns: [t.clinicId, t.providerId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }),
    uniqueIndex("invoice_lines_clinic_invoice_position_active")
      .on(t.clinicId, t.invoiceId, t.position)
      .where(sql.raw("archived_at IS NULL")),
    index("invoice_lines_clinic_invoice_idx").on(t.clinicId, t.invoiceId, t.position),
    index("invoice_lines_clinic_service_idx").on(t.clinicId, t.serviceId),
    index("invoice_lines_clinic_provider_idx").on(t.clinicId, t.providerId),
    check(
      "invoice_lines_description_ar_check",
      sql.raw("((length(description_ar) >= 1) AND (length(description_ar) <= 200))"),
    ),
    check(
      "invoice_lines_description_en_check",
      sql.raw("((length(description_en) >= 1) AND (length(description_en) <= 200))"),
    ),
    check(
      "invoice_lines_kind_check",
      sql.raw("(kind = ANY (ARRAY['service'::text, 'free'::text]))"),
    ),
    lineCap("invoice_lines", "line_total_minor"),
    check("invoice_lines_position_check", sql.raw('(("position" >= 0) AND ("position" <= 49))')),
    check("invoice_lines_quantity_check", sql.raw("((quantity >= 1) AND (quantity <= 999))")),
    check(
      "invoice_lines_service_check",
      sql.raw("((kind = 'service'::text) = (service_id IS NOT NULL))"),
    ),
    lineCap("invoice_lines", "unit_price_minor"),
  ],
);

// 0062 (R1-16, C1): the patient's link. The hash is for lookup; the sealed copy is read by the worker only.
export const invoiceLinks = pgTable(
  "invoice_links",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    notificationId: uuid("notification_id").notNull(),
    tokenHash: bytea("token_hash").notNull(),
    tokenSealed: text("token_sealed").notNull(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    revokedAt: timestamp("revoked_at", tz),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "invoice_links_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "invoice_links_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "invoice_links_clinic_id_invoice_id_fkey",
      columns: [t.clinicId, t.invoiceId],
      foreignColumns: [invoices.clinicId, invoices.id],
    }),
    foreignKey({
      name: "invoice_links_clinic_id_notification_id_fkey",
      columns: [t.clinicId, t.notificationId],
      foreignColumns: [patientNotifications.clinicId, patientNotifications.id],
    }),
    unique("invoice_links_token_hash_unique").on(t.tokenHash),
    uniqueIndex("invoice_links_clinic_notification_live")
      .on(t.clinicId, t.notificationId)
      .where(sql.raw("revoked_at IS NULL")),
    index("invoice_links_clinic_notification_idx").on(t.clinicId, t.notificationId),
    index("invoice_links_clinic_invoice_idx").on(t.clinicId, t.invoiceId),
    check("invoice_links_token_hash_check", sql.raw("(octet_length(token_hash) = 32)")),
    check("invoice_links_token_sealed_check", sql.raw("(token_sealed ~ '^v1\\.'::text)")),
  ],
);
