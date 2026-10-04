import { sql } from "drizzle-orm";
import {
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { branches } from "./branches.ts";
import { clinics } from "./clinics.ts";

// Mirror of db/sql/0010, 0019, 0021. civil_id is sensitive: never logged or audited.
const tz = { withTimezone: true, mode: "date" } as const;

export const patients = pgTable(
  "patients",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    fileNumber: text("file_number").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    birthDate: date("birth_date", { mode: "string" }).notNull(),
    gender: text("gender", { enum: ["male", "female"] }).notNull(),
    registrationBranchId: uuid("registration_branch_id").notNull(),
    civilId: text("civil_id"),
    status: text("status", { enum: ["active", "archived"] }).notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "patients_pkey", columns: [t.clinicId, t.id] }),
    unique("patients_clinic_id_file_number_key").on(t.clinicId, t.fileNumber),
    unique("patients_clinic_id_phone_key").on(t.clinicId, t.phone),
    foreignKey({ name: "patients_clinic_id_fkey", columns: [t.clinicId], foreignColumns: [clinics.id] }),
    foreignKey({
      name: "patients_clinic_id_registration_branch_id_fkey",
      columns: [t.clinicId, t.registrationBranchId],
      foreignColumns: [branches.clinicId, branches.id],
    }),
    index("patients_clinic_name_idx").on(t.clinicId, t.fullName),
    index("patients_clinic_branch_status_idx").on(t.clinicId, t.registrationBranchId, t.status),
    uniqueIndex("patients_clinic_civil_id_unique")
      .on(t.clinicId, t.civilId)
      .where(sql`${t.civilId} IS NOT NULL`),
  ],
);
