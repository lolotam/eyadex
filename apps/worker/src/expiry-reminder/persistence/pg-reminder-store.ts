import { sql, type Database, type IdGenerator, type Tx } from "@eyadex/db";

import { daysLeft, EXPIRY_REMINDER, isDue } from "../domain/reminder-rules.ts";
import type {
  DueClinicFinder,
  ReminderLedger,
  ReminderRecipient,
  ReminderState,
  ReminderStateReader,
} from "../ports/reminder-store.ts";

type ClinicRow = {
  status: "trial" | "active" | "suspended";
  expires_at: string;
  name_ar: string;
  name_en: string;
  default_language: "ar" | "en";
  timezone: string;
};

type MemberRow = { id: string; full_name: string; email: string };
type DueRow = { id: string; expires_at: string };

// The admin is found by its system role key, never by a name (ADR-0012).
const activeAdmins = (tx: Tx, clinicId: string, membershipId: string | null) =>
  tx.execute(
    sql`SELECT m.id, m.full_name, m.email FROM memberships m
        JOIN roles r ON r.clinic_id = m.clinic_id AND r.id = m.role_id
        WHERE m.clinic_id = ${clinicId} AND m.status = 'active'
          AND r.system_key = 'clinic_admin' AND r.is_active
          AND (${membershipId}::uuid IS NULL OR m.id = ${membershipId}::uuid)
        ORDER BY m.id`,
  ) as unknown as Promise<MemberRow[]>;

const toRecipient = (row: MemberRow): ReminderRecipient => ({
  membershipId: row.id,
  fullName: row.full_name,
  email: row.email,
});

/**
 * الفحص على pool المنصة (`eyadex_platform`): بيشوف كل العيادات و`platform_settings` بس، ومالوش أي
 * grant على المراجعين. بيرجّع ids بس، صفحة ورا صفحة بمؤشر `(expires_at, id)` لحد الآخر.
 */
export class PgDueClinicFinder implements DueClinicFinder {
  readonly #db: Database;
  readonly #pageSize: number;

  constructor(db: Database, pageSize = 500) {
    this.#db = db;
    this.#pageSize = pageSize;
  }

  async dueClinics(now: Date): Promise<string[]> {
    const all: string[] = [];
    let after: DueRow | null = null;
    for (;;) {
      const rows = await this.#page(now, after);
      all.push(...rows.map((row) => row.id));
      const last = rows.at(-1);
      if (rows.length < this.#pageSize || last === undefined) return all;
      after = last;
    }
  }

  #page(now: Date, after: DueRow | null): Promise<DueRow[]> {
    const at = now.toISOString();
    // expires_at as full-precision text: the cursor must carry every microsecond PostgreSQL stores.
    return this.#db.withNoTenant(
      (tx) =>
        tx.execute(
          sql`SELECT c.id, to_json(c.expires_at) #>> '{}' AS expires_at
              FROM clinics c, platform_settings s
              WHERE s.id = 1 AND c.status <> 'suspended' AND c.expires_at > ${at}::timestamptz
                AND c.expires_at <= ${at}::timestamptz
                  + make_interval(days => s.alert_days_before_expiry)
                AND (${after?.expires_at ?? null}::timestamptz IS NULL
                     OR (c.expires_at, c.id) >
                        (${after?.expires_at ?? null}::timestamptz, ${after?.id ?? null}::uuid))
              ORDER BY c.expires_at, c.id
              LIMIT ${this.#pageSize}`,
        ) as unknown as Promise<DueRow[]>,
    );
  }
}

/**
 * الدفتر والأحداث في transaction واحدة تحت `withTenant` على `eyadex_app` (0038، RLS): حدث لكل أدمن
 * نشط، فإرسال فاشل لواحد مايعطّلش الباقيين. عيادة من غير أدمن نشط ماتتسجلش، فتتنبّه لما يبقى ليها أدمن.
 */
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
      const admins = await activeAdmins(tx, clinicId, null);
      if (admins.length === 0) return false;
      const reminderId = this.#ids.newId();
      const inserted = (await tx.execute(
        sql`INSERT INTO clinic_expiry_reminders (clinic_id, id, expires_at, created_at)
            VALUES (${clinicId}, ${reminderId}, ${expiresAt.toISOString()}::timestamptz,
                    ${at.toISOString()}::timestamptz)
            ON CONFLICT (clinic_id, expires_at) DO NOTHING
            RETURNING id`,
      )) as unknown as { id: string }[];
      if (inserted.length === 0) return false;
      const days = daysLeft(expiresAt, at);
      for (const admin of admins) {
        const payload = {
          clinicId,
          reminderId,
          expiresAt: expiresAt.toISOString(),
          membershipId: admin.id,
          daysLeft: days,
        };
        await tx.execute(
          sql`INSERT INTO outbox_events (id, clinic_id, event_type, payload, created_at, dispatched_at)
              VALUES (${this.#ids.newId()}, ${clinicId}, ${EXPIRY_REMINDER},
                      ${JSON.stringify(payload)}::jsonb, ${at.toISOString()}::timestamptz, NULL)`,
        );
      }
      return true;
    });
  }
}

/** حالة الإرسال على `eyadex_app` تحت `withTenant`: العيادة، والمستلم لو لسه أدمن نشط. */
export class PgReminderStateReader implements ReminderStateReader {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  read(clinicId: string, membershipId: string): Promise<ReminderState | null> {
    return this.#db.withTenant(clinicId, async (tx) => {
      const clinic = (
        (await tx.execute(
          sql`SELECT status, expires_at, name_ar, name_en, default_language, timezone
              FROM clinics WHERE id = ${clinicId}`,
        )) as unknown as ClinicRow[]
      )[0];
      if (clinic === undefined) return null;
      const [admin] = await activeAdmins(tx, clinicId, membershipId);
      return {
        clinic: {
          status: clinic.status,
          expiresAt: new Date(clinic.expires_at),
          nameAr: clinic.name_ar,
          nameEn: clinic.name_en,
          language: clinic.default_language,
          timezone: clinic.timezone,
        },
        recipient: admin === undefined ? null : toRecipient(admin),
      };
    });
  }
}
