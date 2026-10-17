import { randomUUID } from "node:crypto";

import { owner, ownerJson } from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import { PATIENT_NOTIFICATION_REQUESTED } from "../domain/notification-event.ts";
import { q, type World } from "./notification-fixtures.ts";

let sequence = 0;

/** An issued invoice of the world's patient on its branch, as the API writes it (0060). */
export function seedInvoice(w: World, totalMinor = "12500"): { id: string; number: string } {
  const id = randomUUID();
  sequence += 1;
  const number = `SLM-2026-${String(sequence).padStart(6, "0")}-${id.slice(0, 4)}`;
  owner(`INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source,
           source_id, issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp,
           tax_minor, total_minor, invoice_discount, void_reason, voided_at, version, created_by, created_at,
           updated_at)
         VALUES (${q(w.clinicId)}, ${q(id)}, ${q(w.branchId)}, ${q(w.patientId)}, 2026, ${sequence},
           ${q(number)}, 'issued', 'manual', NULL, now(), 'KWD', 3, ${totalMinor}, 0, 0, 0, ${totalMinor},
           NULL, NULL, NULL, 1, ${q(w.providerId)}, now(), now())`);
  return { id, number };
}

/** The void the API makes (spec §8 rule 10); its link revocation is the API's, not the worker's. */
export const voidInvoice = (w: World, invoiceId: string): void => {
  owner(`UPDATE invoices SET status = 'void', void_reason = 'test', voided_at = now(), version = version + 1
         WHERE clinic_id = ${q(w.clinicId)} AND id = ${q(invoiceId)}`);
};

/** One press of «ابعت»: the invoice row and its outbox event, as PgInvoiceNotifications writes them. */
export function queueInvoice(
  w: World,
  invoiceId: string,
  channel: "email" | "whatsapp" = "email",
): { notificationId: string; eventId: string } {
  const notificationId = randomUUID();
  const eventId = randomUUID();
  owner(`INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id,
           subject_at, send_request_id, status, requested_by, created_at, updated_at)
         VALUES (${q(w.clinicId)}, ${q(notificationId)}, ${q(w.patientId)}, 'invoice', ${q(channel)}, 'invoice',
           ${q(invoiceId)}, NULL, ${q(randomUUID())}, 'queued', ${q(w.providerId)}, now(), now());
         INSERT INTO outbox_events (id, clinic_id, event_type, payload, created_at)
         VALUES (${q(eventId)}, ${q(w.clinicId)}, ${q(PATIENT_NOTIFICATION_REQUESTED)},
           ${q(JSON.stringify({ notificationId }))}::jsonb, now() - interval '1 hour')`);
  return { notificationId, eventId };
}

export interface LinkRow {
  id: string;
  token_hash: string;
  token_sealed: string;
  live: boolean;
}

/** The notification's links, oldest first; `token_hash` as hex. */
export const linksOf = (notificationId: string): LinkRow[] =>
  ownerJson<LinkRow[]>(
    `SELECT id, encode(token_hash, 'hex') AS token_hash, token_sealed,
            revoked_at IS NULL AND expires_at > now() AS live
     FROM invoice_links WHERE notification_id = ${q(notificationId)} ORDER BY created_at, id`,
  );

/** The token at the end of a message's invoice link. */
export const tokenIn = (text: string): string => {
  const match = /\/api\/v1\/public\/invoices\/([A-Za-z0-9_-]{43})/.exec(text);
  if (match === null) throw new Error("no invoice link in the message");
  return match[1]!;
};
