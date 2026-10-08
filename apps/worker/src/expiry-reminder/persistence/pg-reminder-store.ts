import { sql, type Database, type IdGenerator } from "@eyadex/db";

import { EXPIRY_REMINDER, isDue } from "../domain/reminder-rules.ts";
import type {
  DueClinicFinder,
  ReminderLedger,
  ReminderState,
  ReminderStateReader,
} from "../ports/reminder-store.ts";

// The scan reads at most this many clinics per tick; the rest are found on the next one.
const SCAN_LIMIT = 500;

type ClinicRow = {
  status: "trial" | "active" | "suspended";
  expires_at: string;
  name_ar: string;
  name_en: string;
  default_language: "ar" | "en";
  timezone: string;
};

/**
 * الفحص على pool المنصة (`eyadex_platform`): بيشوف كل العيادات و`platform_settings` بس، ومالوش أي
 * grant على المراجعين. بيرجّع ids بس.
 */
export class PgDueClinicFinder implements DueClinicFinder {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  dueClinics(now: Date): Promise<string[]> {
    const at = now.toISOString();
    return this.#db.withNoTenant(async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT c.id FROM clinics c, platform_settings s
            WHERE s.id = 1 AND c.status <> 'suspended' AND c.expires_at > ${at}::timestamptz
              AND c.expires_at <= ${at}::timestamptz
                + make_interval(days => s.alert_days_before_expiry)
            ORDER BY c.expires_at, c.id
            LIMIT ${SCAN_LIMIT}`,
      )) as unknown as { id: string }[];
      return rows.map((row) => row.id);
    });
  }
}

/** الدفتر والحدث في transaction واحدة تحت `withTenant` على `eyadex_app` (0038، RLS). */
export class PgReminderLedger implements ReminderLedger {
  readonly #db: Database;
  readonly #ids: IdGenerator;

  constructor(db: Database, ids: IdGenerator) {
    this.#db = db;
    this.#ids = ids;
  }

  queue(clinicId: string, now: () => Date): Promise<boolean> {
    return this.#db.withTenant(clinicId, async (tx) => {
      const clinic = (
        (await tx.execute(
          sql`SELECT c.status, c.expires_at, s.alert_days_before_expiry AS alert_days
              FROM clinics c, platform_settings s WHERE c.id = ${clinicId} AND s.id = 1`,
        )) as unknown as { status: ClinicRow["status"]; expires_at: string; alert_days: number }[]
      )[0];
      if (clinic === undefined) return false;
      const at = now();
      const expiresAt = new Date(clinic.expires_at);
      if (!isDue({ status: clinic.status, expiresAt }, Number(clinic.alert_days), at)) return false;
      const reminderId = this.#ids.newId();
      const inserted = (await tx.execute(
        sql`INSERT INTO clinic_expiry_reminders (clinic_id, id, expires_at, created_at)
            VALUES (${clinicId}, ${reminderId}, ${expiresAt.toISOString()}::timestamptz,
                    ${at.toISOString()}::timestamptz)
            ON CONFLICT (clinic_id, expires_at) DO NOTHING
            RETURNING id`,
      )) as unknown as { id: string }[];
      if (inserted.length === 0) return false;
      const payload = { clinicId, reminderId, expiresAt: expiresAt.toISOString() };
      await tx.execute(
        sql`INSERT INTO outbox_events (id, clinic_id, event_type, payload, created_at, dispatched_at)
            VALUES (${this.#ids.newId()}, ${clinicId}, ${EXPIRY_REMINDER},
                    ${JSON.stringify(payload)}::jsonb, ${at.toISOString()}::timestamptz, NULL)`,
      );
      return true;
    });
  }
}

/** حالة الإرسال على `eyadex_app` تحت `withTenant`: العيادة وأدمنها النشطين. */
export class PgReminderStateReader implements ReminderStateReader {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  read(clinicId: string): Promise<ReminderState | null> {
    return this.#db.withTenant(clinicId, async (tx) => {
      const clinic = (
        (await tx.execute(
          sql`SELECT status, expires_at, name_ar, name_en, default_language, timezone
              FROM clinics WHERE id = ${clinicId}`,
        )) as unknown as ClinicRow[]
      )[0];
      if (clinic === undefined) return null;
      // The admin is found by its system role key, never by a name (ADR-0012).
      const recipients = (await tx.execute(
        sql`SELECT m.id, m.full_name, m.email FROM memberships m
            JOIN roles r ON r.clinic_id = m.clinic_id AND r.id = m.role_id
            WHERE m.clinic_id = ${clinicId} AND m.status = 'active'
              AND r.system_key = 'clinic_admin' AND r.is_active
            ORDER BY m.id`,
      )) as unknown as { id: string; full_name: string; email: string }[];
      return {
        clinic: {
          status: clinic.status,
          expiresAt: new Date(clinic.expires_at),
          nameAr: clinic.name_ar,
          nameEn: clinic.name_en,
          language: clinic.default_language,
          timezone: clinic.timezone,
        },
        recipients: recipients.map((r) => ({
          membershipId: r.id,
          fullName: r.full_name,
          email: r.email,
        })),
      };
    });
  }
}
