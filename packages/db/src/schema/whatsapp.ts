import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { clinics } from "./clinics.ts";

// Mirror of db/sql/0057 (docs/specs/notifications-design.md §7.1). A clinic table: forced RLS, eyadex_app
// only, never deleted; the platform has no privilege on it.
const tz = { withTimezone: true, mode: "date" } as const;

/** One row per clinic; no row = WhatsApp not linked. No token in clear, never the full number. */
export const clinicWhatsappChannels = pgTable(
  "clinic_whatsapp_channels",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    transport: text("transport", { enum: ["evolution", "coexistence"] }),
    status: text("status", { enum: ["disconnected", "pending", "connected"] }).notNull(),
    instanceName: text("instance_name"),
    phoneLast4: text("phone_last4"),
    riskAcceptedAt: timestamp("risk_accepted_at", tz),
    // The admin's user id; no foreign key (like the audit actor).
    riskAcceptedBy: uuid("risk_accepted_by"),
    riskVersion: integer("risk_version"),
    sealedCredentials: text("sealed_credentials"),
    phoneNumberId: text("phone_number_id"),
    businessAccountId: text("business_account_id"),
    templates: jsonb("templates")
      .notNull()
      .default(sql`'{}'::jsonb`),
    connectedAt: timestamp("connected_at", tz),
    lastError: text("last_error"),
    nextSendAt: timestamp("next_send_at", tz),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "clinic_whatsapp_channels_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "clinic_whatsapp_channels_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    unique("clinic_whatsapp_channels_one_per_clinic").on(t.clinicId),
    check(
      "clinic_whatsapp_channels_transport_check",
      sql.raw("(transport = ANY (ARRAY['evolution'::text, 'coexistence'::text]))"),
    ),
    check(
      "clinic_whatsapp_channels_status_check",
      sql.raw("(status = ANY (ARRAY['disconnected'::text, 'pending'::text, 'connected'::text]))"),
    ),
    check(
      "clinic_whatsapp_channels_phone_last4_check",
      sql.raw("(phone_last4 ~ '^[0-9]{4}$'::text)"),
    ),
    check("clinic_whatsapp_channels_last_error_check", sql.raw("(char_length(last_error) <= 120)")),
  ],
);
