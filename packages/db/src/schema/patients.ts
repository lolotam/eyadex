import { sql } from "drizzle-orm";
import {
  boolean,
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

// Mirror of db/sql/0010, 0019 (+ 0035's index), 0045, 0052 and 0053. The civil ID is sensitive: never logged
// or audited, and stored only as civil_id_enc/hmac/last4 (0052 dropped the plain column and 0021's check).
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
    status: text("status", { enum: ["active", "archived"] }).notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
    civilIdEnc: text("civil_id_enc"),
    civilIdHmac: text("civil_id_hmac"),
    civilIdLast4: text("civil_id_last4"),
    // 0053: where and how the clinic's messages reach the patient (notifications-design.md N-2).
    email: text("email"),
    messageLanguage: text("message_language", { enum: ["ar", "en"] }),
    notificationsOptOut: boolean("notifications_opt_out").notNull().default(false),
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
    check(
      "patients_email_canonical",
      sql.raw(
        "((email = lower(btrim(email))) AND (char_length(email) <= 254) AND (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'::text))",
      ),
    ),
    check(
      "patients_message_language_check",
      sql.raw("(message_language = ANY (ARRAY['ar'::text, 'en'::text]))"),
    ),
    check("patients_file_number_numeric", sql.raw("(file_number ~ '^[1-9][0-9]*$'::text)")),
    check("patients_gender_check", sql.raw("(gender = ANY (ARRAY['male'::text, 'female'::text]))")),
    check(
      "patients_status_check",
      sql.raw("(status = ANY (ARRAY['active'::text, 'archived'::text]))"),
    ),
  ],
);
