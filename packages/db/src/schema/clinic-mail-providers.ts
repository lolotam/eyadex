import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { clinics } from "./clinics.ts";

// Mirror of db/sql/0030 (ADR-0014) and 0055 (a primary and a fallback slot per clinic). A clinic table: forced RLS on clinic_id; credentials only sealed.
const tz = { withTimezone: true, mode: "date" } as const;

export const clinicMailProviders = pgTable(
  "clinic_mail_providers",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    kind: text("kind").notNull(),
    slot: text("slot", { enum: ["primary", "fallback"] })
      .notNull()
      .default(sql`'primary'::text`),
    fromName: text("from_name").notNull(),
    fromEmail: text("from_email").notNull(),
    replyTo: text("reply_to"),
    smtpHost: text("smtp_host"),
    smtpPort: integer("smtp_port"),
    smtpUser: text("smtp_user"),
    sealedCredentials: text("sealed_credentials").notNull(),
    version: integer("version").notNull().default(1),
    verifiedAt: timestamp("verified_at", tz),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    degradedAt: timestamp("degraded_at", tz),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "clinic_mail_providers_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "clinic_mail_providers_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    unique("clinic_mail_providers_one_per_slot").on(t.clinicId, t.slot),
    check(
      "clinic_mail_providers_kind_check",
      sql.raw("(kind = ANY (ARRAY['resend'::text, 'smtp'::text]))"),
    ),
    check(
      "clinic_mail_providers_smtp_port_check",
      sql.raw("((smtp_port >= 1) AND (smtp_port <= 65535))"),
    ),
    check(
      "clinic_mail_providers_consecutive_failures_check",
      sql.raw("(consecutive_failures >= 0)"),
    ),
    check(
      "clinic_mail_providers_slot_check",
      sql.raw("(slot = ANY (ARRAY['primary'::text, 'fallback'::text]))"),
    ),
    check("clinic_mail_providers_version_check", sql.raw("(version >= 1)")),
    check("clinic_mail_providers_last_error_check", sql.raw("(char_length(last_error) <= 120)")),
    check(
      "clinic_mail_providers_kind_fields",
      sql.raw(
        "(((kind = 'smtp'::text) AND (smtp_host IS NOT NULL) AND (smtp_port IS NOT NULL) AND (smtp_user IS NOT NULL)) OR ((kind = 'resend'::text) AND (smtp_host IS NULL) AND (smtp_port IS NULL) AND (smtp_user IS NULL)))",
      ),
    ),
  ],
);
