import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationKind,
  type PatientNotificationList,
} from "@eyadex/contracts/notifications";
import type { Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { appendOutboxEvent } from "../../../shared/outbox.ts";
import type { Clock } from "../../tenancy/index.ts";
import { shouldQueue, subjectOf } from "../domain/notification-rules.ts";
import { publishNotificationRequested } from "../events/published.ts";
import { readNotificationSettings } from "./pg-notification-settings.ts";
import { insertQueuedNotification, notificationsOf } from "./pg-patient-notifications.ts";

/** What the queue adapters need: ids for the row and its event, and the time. */
export interface NotificationQueueDeps {
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

interface QueueRequest {
  readonly clinicId: string;
  readonly kind: NotificationKind;
  readonly subjectId: string;
  readonly startsAt: string | null;
  readonly patientId: string;
  readonly requestedBy: string;
}

/**
 * The one queue step every trigger shares (spec §3.1, §3.4), inside the caller's transaction after its
 * locks: read the clinic's settings (a plain read; defaults when it never saved), and when the channel and
 * the message are on, insert the ledger row and, only when a row was inserted, its outbox event carrying
 * the row id alone. The patient's email and opt-out are decided at send time by the worker.
 */
async function queue(tx: Tx, deps: NotificationQueueDeps, request: QueueRequest): Promise<boolean> {
  const { clinicId, kind } = request;
  const stored = await readNotificationSettings(tx, clinicId);
  if (!shouldQueue(stored?.settings ?? DEFAULT_NOTIFICATION_SETTINGS, kind)) return false;
  const id = deps.ids.newId();
  const now = deps.clock.now();
  const inserted = await insertQueuedNotification(
    tx,
    {
      clinicId,
      id,
      patientId: request.patientId,
      kind,
      subject: subjectOf(kind, request.subjectId, request.startsAt),
      requestedBy: request.requestedBy,
    },
    now,
  );
  if (!inserted) return false;
  await appendOutboxEvent(
    tx,
    publishNotificationRequested(deps.ids.newId(), clinicId, now, { notificationId: id }),
  );
  return true;
}

/** The appointments module's queue and history, bound to its own port in appointments.module.ts. */
export class PgAppointmentNotifications {
  constructor(private readonly deps: NotificationQueueDeps) {}

  /** Queues `booked`, `rescheduled` or `cancelled` for the start the appointment has after the change. */
  queue(
    tx: Tx,
    notice: {
      readonly clinicId: string;
      readonly kind: "booked" | "rescheduled" | "cancelled";
      readonly appointmentId: string;
      readonly patientId: string;
      readonly startsAt: string;
      readonly requestedBy: string;
    },
  ): Promise<boolean> {
    return queue(tx, this.deps, {
      clinicId: notice.clinicId,
      kind: notice.kind,
      subjectId: notice.appointmentId,
      startsAt: notice.startsAt,
      patientId: notice.patientId,
      requestedBy: notice.requestedBy,
    });
  }

  /** The appointment's message history, newest first. */
  async history(tx: Tx, clinicId: string, appointmentId: string): Promise<PatientNotificationList> {
    return { items: await notificationsOf(tx, clinicId, "appointment", appointmentId) };
  }
}

/** The medical module's queue and history, bound to its own port in medical.module.ts. */
export class PgVisitNotifications {
  constructor(private readonly deps: NotificationQueueDeps) {}

  /** Queues the prescription message of a visit just signed with prescription lines (N-5). */
  queuePrescription(
    tx: Tx,
    notice: {
      readonly clinicId: string;
      readonly visitId: string;
      readonly patientId: string;
      readonly requestedBy: string;
    },
  ): Promise<boolean> {
    return queue(tx, this.deps, {
      clinicId: notice.clinicId,
      kind: "prescription",
      subjectId: notice.visitId,
      startsAt: null,
      patientId: notice.patientId,
      requestedBy: notice.requestedBy,
    });
  }

  /** The visit's message history, newest first. */
  async history(tx: Tx, clinicId: string, visitId: string): Promise<PatientNotificationList> {
    return { items: await notificationsOf(tx, clinicId, "visit", visitId) };
  }
}
