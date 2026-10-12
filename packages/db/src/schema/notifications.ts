import { sql } from "drizzle-orm";
import {
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

import { clinics } from "./clinics.ts";
import { patients } from "./patients.ts";

// Mirror of db/sql/0054 and 0056 (docs/specs/notifications-design.md §2). Clinic tables: forced RLS,
// eyadex_app only, never deleted; the platform has no privilege on either.
const tz = { withTimezone: true, mode: "date" } as const;

/** One row per clinic; a clinic without one uses the defaults (email on, every message on). */
export const clinicNotificationSettings = pgTable(
  "clinic_notification_settings",
  {
    clinicId: uuid("clinic_id").notNull(),
    id: uuid("id").notNull(),
    emailEnabled: boolean("email_enabled").notNull(),
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
      enum: ["setting_off", "no_email", "opted_out", "not_booked", "moved"],
    }),
    route: text("route", { enum: ["primary", "fallback", "platform"] }),
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
      sql.raw("(route = ANY (ARRAY['primary'::text, 'fallback'::text, 'platform'::text]))"),
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
        "(skip_reason = ANY (ARRAY['setting_off'::text, 'no_email'::text, 'opted_out'::text, 'not_booked'::text, 'moved'::text]))",
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
