import type { NotificationSettings } from "@eyadex/contracts/notifications";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

// One row per clinic (0054). Every statement runs inside the caller's withTenant(clinicId) transaction
// and filters on clinic_id itself: RLS and the explicit predicate are two independent layers.

interface SettingsRow {
  id: string;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  booked: boolean;
  rescheduled: boolean;
  cancelled: boolean;
  reminder_day: boolean;
  reminder_2h: boolean;
  prescription: boolean;
}

/** The clinic's saved settings and their row id. */
export interface StoredSettings {
  readonly id: string;
  readonly settings: NotificationSettings;
}

/**
 * The clinic's saved settings, or null when it never saved any (the caller applies the defaults). A plain
 * read: no lock, so a booking transaction reads it without a new step in the lock order (ADR-0027).
 */
export async function readNotificationSettings(
  tx: Tx,
  clinicId: string,
): Promise<StoredSettings | null> {
  const rows = await tx.execute<SettingsRow>(
    sql`SELECT id, email_enabled, whatsapp_enabled, booked, rescheduled, cancelled, reminder_day,
               reminder_2h, prescription
        FROM clinic_notification_settings WHERE clinic_id = ${clinicId}`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    settings: {
      emailEnabled: row.email_enabled,
      whatsappEnabled: row.whatsapp_enabled,
      messages: {
        booked: row.booked,
        rescheduled: row.rescheduled,
        cancelled: row.cancelled,
        reminder_day: row.reminder_day,
        reminder_2h: row.reminder_2h,
        prescription: row.prescription,
      },
    },
  };
}

/**
 * Serialises the settings saves of one clinic, so the audit's "before" is the row the save replaces. The
 * save takes no other lock.
 */
export async function lockNotificationSettings(tx: Tx, clinicId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`notification_settings:${clinicId}`}, 0))`,
  );
}

/** Writes the clinic's one row whole: inserted with `id` the first time, replaced after that. */
export async function upsertNotificationSettings(
  tx: Tx,
  clinicId: string,
  id: string,
  settings: NotificationSettings,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  const m = settings.messages;
  await tx.execute(
    sql`INSERT INTO clinic_notification_settings (clinic_id, id, email_enabled, whatsapp_enabled,
          booked, rescheduled, cancelled, reminder_day, reminder_2h, prescription, created_at,
          updated_at)
        VALUES (${clinicId}, ${id}, ${settings.emailEnabled}, ${settings.whatsappEnabled},
          ${m.booked}, ${m.rescheduled},
          ${m.cancelled}, ${m.reminder_day}, ${m.reminder_2h}, ${m.prescription},
          ${at}::timestamptz, ${at}::timestamptz)
        ON CONFLICT ON CONSTRAINT clinic_notification_settings_one_per_clinic DO UPDATE SET
          email_enabled = EXCLUDED.email_enabled, whatsapp_enabled = EXCLUDED.whatsapp_enabled,
          booked = EXCLUDED.booked,
          rescheduled = EXCLUDED.rescheduled, cancelled = EXCLUDED.cancelled,
          reminder_day = EXCLUDED.reminder_day, reminder_2h = EXCLUDED.reminder_2h,
          prescription = EXCLUDED.prescription, updated_at = EXCLUDED.updated_at`,
  );
}
