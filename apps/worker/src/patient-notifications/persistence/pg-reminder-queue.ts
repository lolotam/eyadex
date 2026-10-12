import { sql, type Database, type IdGenerator, type Tx } from "@eyadex/db";

import { PATIENT_NOTIFICATION_REQUESTED } from "../domain/notification-event.ts";
import { dueReminder, type ReminderKind } from "../domain/reminder-windows.ts";
import type { ReminderClinicFinder, ReminderQueue } from "../ports/reminder-queue.ts";
import { readNotificationSettings } from "./settings-row.ts";

/**
 * الفحص على pool المنصة (`eyadex_platform`): بيشوف `clinics` بس ومالوش أي grant على المواعيد ولا
 * المراجعين. `clinic_features` عليها RLS بسياق العيادة بس، فالمنصة ماتقدرش تقراها كلها مرة واحدة؛ فحص
 * الموديول بيحصل جوه سياق كل عيادة على `eyadex_app` (`PgReminderQueue`).
 */
export class PgReminderClinicFinder implements ReminderClinicFinder {
  readonly #db: Database;
  readonly #pageSize: number;

  constructor(db: Database, pageSize = 500) {
    this.#db = db;
    this.#pageSize = pageSize;
  }

  async activeClinics(now: Date): Promise<string[]> {
    const all: string[] = [];
    let after: string | null = null;
    for (;;) {
      const page: string[] = await this.#page(now, after);
      all.push(...page);
      if (page.length < this.#pageSize) return all;
      after = page.at(-1) ?? null;
    }
  }

  async #page(now: Date, after: string | null): Promise<string[]> {
    // A suspended or expired clinic has no access (CLAUDE.md §6), so it sends nothing either.
    const rows = (await this.#db.withNoTenant((tx) =>
      tx.execute(
        sql`SELECT id FROM clinics
            WHERE status <> 'suspended' AND expires_at > ${now.toISOString()}::timestamptz
              AND (${after}::uuid IS NULL OR id > ${after}::uuid)
            ORDER BY id LIMIT ${this.#pageSize}`,
      ),
    )) as unknown as { id: string }[];
    return rows.map((row) => row.id);
  }
}

type Cursor = { startsAt: string; id: string };
type CandidateRow = { id: string; starts_at: string; created_at: string };
type PageResult = { queued: number; next: Cursor | null };

const DONE: PageResult = { queued: 0, next: null };

/**
 * الدفتر والأحداث في transaction واحدة لكل صفحة تحت `withTenant` على `eyadex_app` (0056، RLS). القيد
 * `patient_notifications_once` هو اللي بيضمن تذكير واحد لكل بداية موعد مهما اتكرر الفحص أو كتر عدد
 * الـ workers؛ وتأجيل الموعد (بداية جديدة) بياخد تذكيرات جديدة.
 */
export class PgReminderQueue implements ReminderQueue {
  readonly #db: Database;
  readonly #ids: IdGenerator;
  readonly #pageSize: number;

  constructor(db: Database, ids: IdGenerator, pageSize = 200) {
    this.#db = db;
    this.#ids = ids;
    this.#pageSize = pageSize;
  }

  async queue(clinicId: string, now: () => Date): Promise<number> {
    let queued = 0;
    let after: Cursor | null = null;
    do {
      const page: PageResult = await this.#db.withTenant(clinicId, (tx) =>
        this.#page(tx, clinicId, now(), after),
      );
      queued += page.queued;
      after = page.next;
    } while (after !== null);
    return queued;
  }

  async #page(tx: Tx, clinicId: string, at: Date, after: Cursor | null): Promise<PageResult> {
    // A module with no row is off (ADR-0010).
    const [module] = (await tx.execute(
      sql`SELECT enabled FROM clinic_features
          WHERE clinic_id = ${clinicId} AND module = 'appointments'`,
    )) as unknown as { enabled: boolean }[];
    if (module?.enabled !== true) return DONE;
    const settings = await readNotificationSettings(tx, clinicId, false);
    const allowed = (kind: ReminderKind) => settings.emailEnabled && settings.messages[kind];
    if (!allowed("reminder_day") && !allowed("reminder_2h")) return DONE;
    const now = at.toISOString();
    // The coarse filter: a start within the next 24 hours, booked at least 2 hours before it. dueReminder
    // decides the window. Timestamps as full-precision text, so the cursor loses no microsecond.
    const rows = (await tx.execute(
      sql`SELECT id, to_json(starts_at) #>> '{}' AS starts_at, to_json(created_at) #>> '{}' AS created_at
          FROM appointments
          WHERE clinic_id = ${clinicId} AND status = 'booked'
            AND starts_at > ${now}::timestamptz
            AND starts_at <= ${now}::timestamptz + interval '24 hours'
            AND created_at < starts_at - interval '2 hours'
            AND (${after?.startsAt ?? null}::timestamptz IS NULL
                 OR (starts_at, id) > (${after?.startsAt ?? null}::timestamptz, ${after?.id ?? null}::uuid))
          ORDER BY starts_at, id
          LIMIT ${this.#pageSize}`,
    )) as unknown as CandidateRow[];
    let queued = 0;
    for (const row of rows) {
      const kind = dueReminder(
        { startsAt: new Date(row.starts_at), createdAt: new Date(row.created_at) },
        at,
      );
      if (kind !== null && allowed(kind) && (await this.#insert(tx, clinicId, row.id, kind, now))) {
        queued += 1;
      }
    }
    const last = rows.at(-1);
    return {
      queued,
      next:
        rows.length < this.#pageSize || last === undefined
          ? null
          : { startsAt: last.starts_at, id: last.id },
    };
  }

  // subject_at is copied from the row itself, so it is the start to the microsecond and the send-time
  // "moved" check compares like with like.
  async #insert(
    tx: Tx,
    clinicId: string,
    appointmentId: string,
    kind: ReminderKind,
    now: string,
  ): Promise<boolean> {
    const inserted = (await tx.execute(
      sql`INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type,
            subject_id, subject_at, status, requested_by, attempts, created_at, updated_at)
          SELECT a.clinic_id, ${this.#ids.newId()}, a.patient_id, ${kind}, 'email', 'appointment',
            a.id, a.starts_at, 'queued', NULL, 0, ${now}::timestamptz, ${now}::timestamptz
          FROM appointments a WHERE a.clinic_id = ${clinicId} AND a.id = ${appointmentId}
          ON CONFLICT ON CONSTRAINT patient_notifications_once DO NOTHING
          RETURNING id`,
    )) as unknown as { id: string }[];
    const row = inserted[0];
    if (row === undefined) return false;
    // The ledger id only: no address and no text in the outbox (spec §2).
    await tx.execute(
      sql`INSERT INTO outbox_events (id, clinic_id, event_type, payload, created_at, dispatched_at)
          VALUES (${this.#ids.newId()}, ${clinicId}, ${PATIENT_NOTIFICATION_REQUESTED},
                  ${JSON.stringify({ notificationId: row.id })}::jsonb, ${now}::timestamptz, NULL)`,
    );
    return true;
  }
}
