import type { NotificationKind, PatientNotification } from "@eyadex/contracts/notifications";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { NotificationSubject } from "../domain/notification-rules.ts";

// The ledger (0056): one row per message per channel, no address and no text. Every statement runs
// inside the caller's withTenant(clinicId) transaction and filters on clinic_id itself.

/** A queued email for one patient about one subject. */
export interface QueuedNotification {
  readonly clinicId: string;
  readonly id: string;
  readonly patientId: string;
  readonly kind: NotificationKind;
  readonly subject: NotificationSubject;
  /** The membership that triggered it. */
  readonly requestedBy: string;
}

/**
 * Inserts one `queued` email row; a second request for the same message (same subject, kind, channel and
 * start) conflicts on `patient_notifications_once` and inserts nothing. The patient foreign key takes its
 * key-share lock here, after the appointment or visit row the caller already holds (ADR-0027).
 *
 * @returns true when the row was inserted
 */
export async function insertQueuedNotification(
  tx: Tx,
  row: QueuedNotification,
  now: Date,
): Promise<boolean> {
  const at = now.toISOString();
  const { subject } = row;
  const inserted = await tx.execute<{ id: string }>(
    sql`INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type,
          subject_id, subject_at, status, requested_by, created_at, updated_at)
        VALUES (${row.clinicId}, ${row.id}, ${row.patientId}, ${row.kind}, 'email',
          ${subject.subjectType}, ${subject.subjectId}, ${subject.subjectAt}::timestamptz, 'queued',
          ${row.requestedBy}, ${at}::timestamptz, ${at}::timestamptz)
        ON CONFLICT ON CONSTRAINT patient_notifications_once DO NOTHING
        RETURNING id`,
  );
  return inserted.length > 0;
}

interface HistoryRow {
  id: string;
  kind: PatientNotification["kind"];
  channel: PatientNotification["channel"];
  status: PatientNotification["status"];
  skip_reason: PatientNotification["skipReason"];
  route: PatientNotification["route"];
  created_at: string | Date;
  sent_at: string | Date | null;
}

const iso = (value: string | Date) => new Date(value).toISOString();

/**
 * The message history of one appointment or visit, newest first (the subject index). No address, no text.
 *
 * @returns the rows as the contract's history items
 */
export async function notificationsOf(
  tx: Tx,
  clinicId: string,
  subjectType: NotificationSubject["subjectType"],
  subjectId: string,
): Promise<PatientNotification[]> {
  const rows = await tx.execute<HistoryRow>(
    sql`SELECT id, kind, channel, status, skip_reason, route, created_at, sent_at
        FROM patient_notifications
        WHERE clinic_id = ${clinicId} AND subject_id = ${subjectId}
          AND subject_type = ${subjectType}
        ORDER BY created_at DESC, id DESC`,
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    channel: row.channel,
    status: row.status,
    skipReason: row.skip_reason,
    route: row.route,
    createdAt: iso(row.created_at),
    sentAt: row.sent_at === null ? null : iso(row.sent_at),
  }));
}
