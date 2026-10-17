import type {
  NotificationChannel,
  NotificationKind,
  PatientNotification,
} from "@eyadex/contracts/notifications";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { NotificationSubject } from "../domain/notification-rules.ts";
import { notificationFailureReason } from "../domain/notification-failure-reason.ts";

// The ledger (0056): one row per message per channel, no address and no text. Every statement runs
// inside the caller's withTenant(clinicId) transaction and filters on clinic_id itself.

/** A queued message for one patient about one subject, on one channel. */
export interface QueuedNotification {
  readonly clinicId: string;
  readonly id: string;
  readonly patientId: string;
  readonly kind: NotificationKind;
  readonly channel: NotificationChannel;
  readonly subject: NotificationSubject;
  /** The membership that triggered it. */
  readonly requestedBy: string;
}

/**
 * Inserts one `queued` row on its channel; a second request for the same message (same subject, kind, channel and
 * start) conflicts on the `patient_notifications_once` index (0062: partial, invoices excluded) and inserts nothing. The patient foreign key takes its
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
        VALUES (${row.clinicId}, ${row.id}, ${row.patientId}, ${row.kind}, ${row.channel},
          ${subject.subjectType}, ${subject.subjectId}, ${subject.subjectAt}::timestamptz, 'queued',
          ${row.requestedBy}, ${at}::timestamptz, ${at}::timestamptz)
        ON CONFLICT (clinic_id, subject_id, kind, channel, subject_at) WHERE subject_type <> 'invoice'
        DO NOTHING
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
  last_error: string | null;
  delivered_at: string | Date | null;
  read_at: string | Date | null;
}

const iso = (value: string | Date) => new Date(value).toISOString();

/**
 * The message history of one appointment or visit, newest first (the subject index). No address, no text;
 * WhatsApp rows carry the delivery and read times their provider reported (N3).
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
    sql`SELECT id, kind, channel, status, skip_reason, route, created_at, sent_at, last_error,
               delivered_at, read_at
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
    // A failed row keeps its route only when the provider had accepted it (0059's sent_check).
    failureReason: notificationFailureReason(row.status, row.last_error, row.route !== null),
    deliveredAt: row.delivered_at === null ? null : iso(row.delivered_at),
    readAt: row.read_at === null ? null : iso(row.read_at),
  }));
}
