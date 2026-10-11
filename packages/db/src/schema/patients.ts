import { sql } from "drizzle-orm";
import {
  check,
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

// Mirror of db/sql/0010, 0019, 0021 (+ 0035's index) and 0045. civil_id is sensitive: never logged or
// audited; from 0045 it is written only as civil_id_enc/hmac/last4 and the plain column is legacy (R1-5).
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
    civilIdEnc: text("civil_id_enc"),
    civilIdHmac: text("civil_id_hmac"),
    civilIdLast4: text("civil_id_last4"),
  },
  (t) => [
    primaryKey({ name: "patients_pkey", columns: [t.clinicId, t.id] }),
    unique("patients_clinic_id_file_number_key").on(t.clinicId, t.fileNumber),
    unique("patients_clinic_id_phone_key").on(t.clinicId, t.phone),
    foreignKey({
      name: "patients_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "patients_clinic_id_registration_branch_id_fkey",
      columns: [t.clinicId, t.registrationBranchId],
      foreignColumns: [branches.clinicId, branches.id],
    }),
    index("patients_clinic_name_idx").on(t.clinicId, t.fullName),
    index("patients_clinic_branch_status_idx").on(t.clinicId, t.registrationBranchId, t.status),
    index("patients_clinic_file_number_num_idx").on(t.clinicId, sql`((file_number)::bigint)`),
    uniqueIndex("patients_clinic_civil_id_unique")
      .on(t.clinicId, t.civilId)
      .where(sql`${t.civilId} IS NOT NULL`),
    check(
      "patients_civil_id_digits",
      sql.raw(
        "((civil_id IS NULL) OR ((length(civil_id) = 12) AND (translate(civil_id, '0123456789'::text, ''::text) = ''::text)))",
      ),
    ),
    uniqueIndex("patients_clinic_civil_id_hmac_unique")
      .on(t.clinicId, t.civilIdHmac)
      .where(sql`${t.civilIdHmac} IS NOT NULL`),
    check(
      "patients_civil_id_encrypted_together",
      sql.raw(
        "(((civil_id_enc IS NULL) = (civil_id_hmac IS NULL)) AND ((civil_id_enc IS NULL) = (civil_id_last4 IS NULL)))",
      ),
    ),
    check(
      "patients_civil_id_hmac_hex",
      sql.raw("((civil_id_hmac IS NULL) OR (civil_id_hmac ~ '^[0-9a-f]{64}$'::text))"),
    ),
    check(
      "patients_civil_id_last4_digits",
      sql.raw("((civil_id_last4 IS NULL) OR (civil_id_last4 ~ '^[0-9]{4}$'::text))"),
    ),
    check("patients_file_number_numeric", sql.raw("(file_number ~ '^[1-9][0-9]*$'::text)")),
    check("patients_gender_check", sql.raw("(gender = ANY (ARRAY['male'::text, 'female'::text]))")),
    check(
      "patients_status_check",
      sql.raw("(status = ANY (ARRAY['active'::text, 'archived'::text]))"),
    ),
  ],
);
