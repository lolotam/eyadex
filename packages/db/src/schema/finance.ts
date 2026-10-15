import { sql } from "drizzle-orm";
import {
  check,
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
} from "drizzle-orm/pg-core";

import { branches } from "./branches.ts";
import { clinics } from "./clinics.ts";
import { memberships } from "./memberships.ts";
import { clinicServices } from "./scheduling.ts";
import { lineCap, minor, tz } from "./finance-columns.ts";

// Mirror of db/sql/0060 and 0062 (finance spec §3.2, R1, R2, C1). Clinic tables: forced RLS, eyadex_app
// only, never deleted except the doctor price list (configuration, replaced as a whole). Amounts are
// bigint minor units; a line is capped at 10¹², aggregates by the type.

export const usedInvoicePrefixes = pgTable(
  "used_invoice_prefixes",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    prefix: text("prefix").notNull(),
    branchId: uuid("branch_id").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "used_invoice_prefixes_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "used_invoice_prefixes_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "used_invoice_prefixes_clinic_id_branch_id_fkey",
      columns: [t.clinicId, t.branchId],
      foreignColumns: [branches.clinicId, branches.id],
    }),
    unique("used_invoice_prefixes_prefix_unique").on(t.clinicId, t.prefix),
    index("used_invoice_prefixes_clinic_branch_idx").on(t.clinicId, t.branchId),
    check("used_invoice_prefixes_prefix_check", sql.raw("(prefix ~ '^[A-Z0-9]{2,6}$'::text)")),
  ],
);

export const serviceProviderPrices = pgTable(
  "service_provider_prices",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    serviceId: uuid("service_id").notNull(),
    memberId: uuid("member_id").notNull(),
    priceMinor: minor("price_minor").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "service_provider_prices_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "service_provider_prices_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "service_provider_prices_clinic_id_service_id_fkey",
      columns: [t.clinicId, t.serviceId],
      foreignColumns: [clinicServices.clinicId, clinicServices.id],
    }),
    foreignKey({
      name: "service_provider_prices_clinic_id_member_id_fkey",
      columns: [t.clinicId, t.memberId],
      foreignColumns: [memberships.clinicId, memberships.id],
    }),
    unique("service_provider_prices_unique").on(t.clinicId, t.serviceId, t.memberId),
    index("service_provider_prices_clinic_member_idx").on(t.clinicId, t.memberId),
    lineCap("service_provider_prices", "price_minor"),
  ],
);

export const invoiceSequences = pgTable(
  "invoice_sequences",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    branchId: uuid("branch_id").notNull(),
    year: smallint("year").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "invoice_sequences_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "invoice_sequences_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "invoice_sequences_clinic_id_branch_id_fkey",
      columns: [t.clinicId, t.branchId],
      foreignColumns: [branches.clinicId, branches.id],
    }),
    unique("invoice_sequences_branch_year_unique").on(t.clinicId, t.branchId, t.year),
    check("invoice_sequences_next_number_check", sql.raw("(next_number >= 1)")),
    check("invoice_sequences_year_check", sql.raw("((year >= 2000) AND (year <= 9999))")),
  ],
);
