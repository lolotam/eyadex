import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Mirror of db/sql/0001 + 0002 (+ 0031's index). db/sql stays the source of truth; the drift test compares the two.
// Constraint names repeat PostgreSQL's defaults so the drift test can match them by name.
const tz = { withTimezone: true, mode: "date" } as const;

export const clinics = pgTable(
  "clinics",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    specialty: text("specialty", {
      enum: ["psychiatry", "psychology", "dental", "dermatology", "obgyn", "general"],
    }).notNull(),
    defaultLanguage: text("default_language", { enum: ["ar", "en"] }).notNull(),
    timezone: text("timezone").notNull(),
    status: text("status", { enum: ["trial", "active", "suspended"] }).notNull(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    maxUsers: integer("max_users").notNull(),
    maxBranches: integer("max_branches").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    unique("clinics_slug_key").on(t.slug),
    index("clinics_status_expires_idx").on(t.status, t.expiresAt),
    index("clinics_created_at_id_idx").on(t.createdAt, t.id),
    check(
      "clinics_default_language_check",
      sql.raw("(default_language = ANY (ARRAY['ar'::text, 'en'::text]))"),
    ),
    check("clinics_max_branches_check", sql.raw("(max_branches > 0)")),
    check("clinics_max_users_check", sql.raw("(max_users > 0)")),
    check("clinics_slug_check", sql.raw("(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)")),
    check(
      "clinics_specialty_check",
      sql.raw(
        "(specialty = ANY (ARRAY['psychiatry'::text, 'psychology'::text, 'dental'::text, 'dermatology'::text, 'obgyn'::text, 'general'::text]))",
      ),
    ),
    check(
      "clinics_status_check",
      sql.raw("(status = ANY (ARRAY['trial'::text, 'active'::text, 'suspended'::text]))"),
    ),
  ],
);

export const clinicFeatures = pgTable(
  "clinic_features",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    module: text("module", { enum: ["patients"] }).notNull(),
    enabled: boolean("enabled").notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "clinic_features_pkey", columns: [t.clinicId, t.id] }),
    unique("clinic_features_clinic_id_module_key").on(t.clinicId, t.module),
    foreignKey({
      name: "clinic_features_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    check("clinic_features_module_check", sql.raw("(module = 'patients'::text)")),
  ],
);

export const clinicCounters = pgTable(
  "clinic_counters",
  {
    clinicId: uuid("clinic_id").notNull(),
    name: text("name", { enum: ["patient_file_number"] }).notNull(),
    value: bigint("value", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "clinic_counters_pkey", columns: [t.clinicId, t.name] }),
    foreignKey({
      name: "clinic_counters_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    check("clinic_counters_name_check", sql.raw("(name = 'patient_file_number'::text)")),
    check("clinic_counters_value_check", sql.raw("(value > 0)")),
  ],
);
