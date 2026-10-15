import type { NotificationChannel } from "@eyadex/contracts/notifications";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { ApiError } from "../../../shared/errors.ts";
import { appendOutboxEvent } from "../../../shared/outbox.ts";
import { publishNotificationRequested } from "../events/published.ts";
import type { NotificationQueueDeps } from "./pg-notification-queue.ts";

/** One press of «ابعت» on an invoice (spec §8 rule 15, R2-5). */
export interface InvoiceSendRequest {
  readonly clinicId: string;
  readonly invoiceId: string;
  readonly patientId: string;
  readonly channel: NotificationChannel;
  readonly sendRequestId: string;
  /** The membership that pressed it. */
  readonly requestedBy: string;
}

/**
 * The billing module's invoice queue, bound to its own port in billing.module.ts. Unlike the automatic
 * messages, an invoice row is queued whatever the clinic's settings say: a member asked for it, so the
 * worker decides at send time and the history shows why a message was skipped.
 */
export class PgInvoiceNotifications {
  constructor(private readonly deps: NotificationQueueDeps) {}

  /**
   * Queues one `invoice` row and its outbox event, keyed by the client's `sendRequestId` (0062). A repeated
   * id with the same invoice and channel answers with the first row; with another invoice or channel it is
   * `send_request_conflict`, and nothing is written.
   *
   * @returns the ledger row id
   */
  async queueInvoice(tx: Tx, request: InvoiceSendRequest): Promise<string> {
    const { clinicId } = request;
    const id = this.deps.ids.newId();
    const now = this.deps.clock.now();
    const at = now.toISOString();
    const inserted = await tx.execute<{ id: string }>(
      sql`INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type,
            subject_id, subject_at, send_request_id, status, requested_by, created_at, updated_at)
          VALUES (${clinicId}, ${id}, ${request.patientId}, 'invoice', ${request.channel}, 'invoice',
            ${request.invoiceId}, NULL, ${request.sendRequestId}, 'queued', ${request.requestedBy},
            ${at}::timestamptz, ${at}::timestamptz)
          ON CONFLICT (clinic_id, send_request_id) WHERE send_request_id IS NOT NULL DO NOTHING
          RETURNING id`,
    );
    if (inserted.length === 0) return this.replay(tx, request);
    await appendOutboxEvent(
      tx,
      publishNotificationRequested(this.deps.ids.newId(), clinicId, now, { notificationId: id }),
    );
    return id;
  }

  private async replay(tx: Tx, request: InvoiceSendRequest): Promise<string> {
    const [first] = await tx.execute<{ id: string; subject_id: string; channel: string }>(
      sql`SELECT id, subject_id, channel FROM patient_notifications
          WHERE clinic_id = ${request.clinicId} AND send_request_id = ${request.sendRequestId}`,
    );
    if (
      first === undefined ||
      first.subject_id !== request.invoiceId ||
      first.channel !== request.channel
    ) {
      throw new ApiError("send_request_conflict");
    }
    return first.id;
  }
}
