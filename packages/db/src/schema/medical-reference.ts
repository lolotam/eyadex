import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { clinics } from "./clinics.ts";

// Mirror of db/sql/0047 (icd10_codes) and 0048 (clinic_medicines): reference lists, stored plain (spec
// §3). icd10_codes is global (no clinic_id, no RLS) and loaded by the owner; clinic_medicines is a clinic
// table under forced RLS, eyadex_app only.
const tz = { withTimezone: true, mode: "date" } as const;

export const icd10Codes = pgTable(
  "icd10_codes",
  {
    code: text("code").primaryKey(),
    titleEn: text("title_en").notNull(),
    billable: boolean("billable").notNull(),
    release: text("release").notNull(),
  },
  (t) => [
    index("icd10_codes_title_trgm_idx").using("gin", sql`lower(${t.titleEn}) gin_trgm_ops`),
  ],
);

export const clinicMedicines = pgTable(
  "clinic_medicines",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    name: text("name").notNull(),
    defaultDose: text("default_dose"),
    defaultFrequency: text("default_frequency"),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "clinic_medicines_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "clinic_medicines_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    uniqueIndex("clinic_medicines_name_unique").on(t.clinicId, sql`lower(btrim(${t.name}))`),
    check(
      "clinic_medicines_status_check",
      sql.raw("(status = ANY (ARRAY['active'::text, 'inactive'::text]))"),
    ),
  ],
);
