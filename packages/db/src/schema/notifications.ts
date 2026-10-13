import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
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
import { patients } from "./patients.ts";

// Mirror of db/sql/0054, 0056, 0057 and 0058 (docs/specs/notifications-design.md §2, §7.1). Clinic
// tables: forced RLS, eyadex_app only, never deleted; the platform has no privilege on any of them.
const tz = { withTimezone: true, mode: "date" } as const;

/** One row per clinic; a clinic without one uses the defaults (email on, WhatsApp off, every message on). */
export const clinicNotificationSettings = pgTable(
  "clinic_notification_settings",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    emailEnabled: boolean("email_enabled").notNull(),
    // 0058: off until the clinic links WhatsApp and turns it on.
    whatsappEnabled: boolean("whatsapp_enabled").notNull().default(false),
    booked: boolean("booked").notNull(),
    rescheduled: boolean("rescheduled").notNull(),
    cancelled: boolean("cancelled").notNull(),
    reminderDay: boolean("reminder_day").notNull(),
    reminder2h: boolean("reminder_2h").notNull(),
    prescription: boolean("prescription").notNull(),
    createdAt: timestamp("created_at", tz).notNull(),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "clinic_notification_settings_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "clinic_notification_settings_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    unique("clinic_notification_settings_one_per_clinic").on(t.clinicId),
  ],
);

/** The ledger: one row per message per channel; no address and no text. */
export const patientNotifications = pgTable(
  "patient_notifications",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    patientId: uuid("patient_id").notNull(),
    kind: text("kind", {
      enum: ["booked", "rescheduled", "cancelled", "reminder_day", "reminder_2h", "prescription"],
    }).notNull(),
    channel: text("channel", { enum: ["email", "whatsapp"] }).notNull(),
    subjectType: text("subject_type", { enum: ["appointment", "visit"] }).notNull(),
    // An appointment or a visit, by subject_type: no foreign key.
    subjectId: uuid("subject_id").notNull(),
    subjectAt: timestamp("subject_at", tz),
    status: text("status", { enum: ["queued", "sent", "skipped", "failed"] }).notNull(),
    skipReason: text("skip_reason", {
      enum: [
        "setting_off",
        "no_email",
        "opted_out",
        "not_booked",
        "moved",
        "whatsapp_disconnected",
        "template_missing",
      ],
    }),
    route: text("route", {
      enum: ["primary", "fallback", "platform", "evolution", "coexistence"],
    }),
    // The requesting membership; no foreign key (ADR-0027, as appointments.created_by).
    requestedBy: uuid("requested_by"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", tz).notNull(),
    sentAt: timestamp("sent_at", tz),
    updatedAt: timestamp("updated_at", tz).notNull(),
  },
  (t) => [
    primaryKey({ name: "patient_notifications_pkey", columns: [t.clinicId, t.id] }),
    foreignKey({
      name: "patient_notifications_clinic_id_fkey",
      columns: [t.clinicId],
      foreignColumns: [clinics.id],
    }),
    foreignKey({
      name: "patient_notifications_clinic_id_patient_id_fkey",
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
    unique("patient_notifications_once")
      .on(t.clinicId, t.subjectId, t.kind, t.channel, t.subjectAt)
      .nullsNotDistinct(),
    index("patient_notifications_clinic_subject_created_idx").on(
      t.clinicId,
      t.subjectId,
      t.createdAt.desc().nullsFirst(),
    ),
    index("patient_notifications_clinic_patient_idx").on(t.clinicId, t.patientId),
    check("patient_notifications_attempts_check", sql.raw("(attempts >= 0)")),
    check(
      "patient_notifications_channel_check",
      sql.raw("(channel = ANY (ARRAY['email'::text, 'whatsapp'::text]))"),
    ),
    check(
      "patient_notifications_kind_check",
      sql.raw(
        "(kind = ANY (ARRAY['booked'::text, 'rescheduled'::text, 'cancelled'::text, 'reminder_day'::text, 'reminder_2h'::text, 'prescription'::text]))",
      ),
    ),
    check("patient_notifications_last_error_check", sql.raw("(char_length(last_error) <= 120)")),
    check(
      "patient_notifications_route_check",
      sql.raw(
        "(route = ANY (ARRAY['primary'::text, 'fallback'::text, 'platform'::text, 'evolution'::text, 'coexistence'::text]))",
      ),
    ),
    check(
      "patient_notifications_sent_check",
      sql.raw(
        "(((status = 'sent'::text) = (route IS NOT NULL)) AND ((status = 'sent'::text) = (sent_at IS NOT NULL)))",
      ),
    ),
    check(
      "patient_notifications_skip_reason_check",
      sql.raw(
        "(skip_reason = ANY (ARRAY['setting_off'::text, 'no_email'::text, 'opted_out'::text, 'not_booked'::text, 'moved'::text, 'whatsapp_disconnected'::text, 'template_missing'::text]))",
      ),
    ),
    check(
      "patient_notifications_skipped_check",
      sql.raw("((status = 'skipped'::text) = (skip_reason IS NOT NULL))"),
    ),
    check(
      "patient_notifications_status_check",
      sql.raw(
        "(status = ANY (ARRAY['queued'::text, 'sent'::text, 'skipped'::text, 'failed'::text]))",
      ),
    ),
    check(
      "patient_notifications_subject_check",
      sql.raw(
        "(((kind = 'prescription'::text) = (subject_type = 'visit'::text)) AND ((subject_type = 'appointment'::text) = (subject_at IS NOT NULL)))",
      ),
    ),
    check(
      "patient_notifications_subject_type_check",
      sql.raw("(subject_type = ANY (ARRAY['appointment'::text, 'visit'::text]))"),
    ),
  ],
);

/**
 * The clinic's WhatsApp channel (0057): one row per clinic, none = never linked. The coexistence token
 * is sealed with MAIL_PROVIDER_SEAL_KEY bound to the row id; only the number's last four digits are kept.
 */
export const clinicWhatsappChannels = pgTable(
  "clinic_whatsapp_channels",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    transport: text("transport", { enum: ["evolution", "coexistence"] }),
    status: text("status", { enum: ["disconnected", "pending", "connected"] }).notNull(),
    instanceName: text("instance_name"),
    phoneLast4: text("phone_last4"),
    // The admin's user id; no foreign key (an auth identity, like audit_log.actor_user_id).
    riskAcceptedAt: timestamp("risk_accepted_at", tz),
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
    operationId: uuid("operation_id"),
    operationExpiresAt: timestamp("operation_expires_at", tz),
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
      "clinic_whatsapp_channels_business_account_id_check",
      sql.raw("(business_account_id ~ '^[0-9]{5,30}$'::text)"),
    ),
    check(
      "clinic_whatsapp_channels_instance_name_check",
      sql.raw("(char_length(instance_name) <= 100)"),
    ),
    check("clinic_whatsapp_channels_last_error_check", sql.raw("(char_length(last_error) <= 120)")),
    check(
      "clinic_whatsapp_channels_link_check",
      sql.raw(
        "(((status = 'disconnected'::text) OR (transport IS NOT NULL)) AND ((status = 'connected'::text) = (connected_at IS NOT NULL)))",
      ),
    ),
    check(
      "clinic_whatsapp_channels_phone_last4_check",
      sql.raw("(phone_last4 ~ '^[0-9]{4}$'::text)"),
    ),
    check(
      "clinic_whatsapp_channels_phone_number_id_check",
      sql.raw("(phone_number_id ~ '^[0-9]{5,30}$'::text)"),
    ),
    check(
      "clinic_whatsapp_channels_risk_check",
      sql.raw(
        "(((risk_accepted_at IS NULL) = (risk_accepted_by IS NULL)) AND ((risk_accepted_at IS NULL) = (risk_version IS NULL)))",
      ),
    ),
    check("clinic_whatsapp_channels_risk_version_check", sql.raw("(risk_version >= 1)")),
    check(
      "clinic_whatsapp_channels_status_check",
      sql.raw("(status = ANY (ARRAY['disconnected'::text, 'pending'::text, 'connected'::text]))"),
    ),
    check(
      "clinic_whatsapp_channels_templates_check",
      sql.raw("(jsonb_typeof(templates) = 'object'::text)"),
    ),
    check(
      "clinic_whatsapp_channels_transport_check",
      sql.raw("(transport = ANY (ARRAY['evolution'::text, 'coexistence'::text]))"),
    ),
  ],
);
