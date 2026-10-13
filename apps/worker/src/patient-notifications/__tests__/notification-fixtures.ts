import { randomBytes, randomUUID } from "node:crypto";

import type { NotificationKind } from "@eyadex/contracts/notifications";
import type { Database, DispatcherOutbox } from "@eyadex/db";
import { FieldCipher, SecretSealer } from "@eyadex/secrets";

import {
  captureLogs,
  FakeMail,
  owner,
  ownerJson,
  seedClinic,
} from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import type { ClinicProviderCredentials } from "../../mail-provider-test/ports/clinic-sender-factory.ts";
import { OutboxPoller } from "../../shared/outbox-poller.ts";
import { PATIENT_NOTIFICATION_REQUESTED } from "../domain/notification-event.ts";
import { PgNotificationStore } from "../persistence/pg-notification-store.ts";
import type { MetaSender } from "../ports/meta-sender.ts";
import type { WhatsappSender } from "../ports/whatsapp-sender.ts";
import { notificationDispatcher } from "../send-notification.ts";

export const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
export const PROVIDER_KEY = randomBytes(32).toString("base64");
export const PLATFORM_FROM = "Eyadex <noreply@example.invalid>";
export const cipher = new FieldCipher(new Map([[1, randomBytes(32)]]), 1);

export interface World {
  readonly clinicId: string;
  /** The patient's phone as stored: eight digits (a fake number). */
  readonly phone: string;
  readonly branchId: string;
  readonly providerId: string;
  readonly staffUserId: string;
  readonly patientId: string;
  readonly email: string;
}

/** A clinic with one branch, one bookable member and one patient with an email. */
export function seedWorld(language: "ar" | "en" = "en"): World {
  const { clinicId, roleId } = seedClinic(language);
  const branchId = randomUUID();
  const providerId = randomUUID();
  const staffUserId = randomUUID();
  const patientId = randomUUID();
  const email = `patient-${patientId.slice(0, 8)}@example.invalid`;
  const phone = `5${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  owner(`INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, address, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(branchId)}, 'فرع السالمية', 'Salmiya', true, 'Block 2', now(), now());
         INSERT INTO memberships (clinic_id, id, user_id, full_name, email, role_id, all_branches, status,
           preferred_language, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(providerId)}, ${q(staffUserId)}, 'Dr. Huda',
           ${q(`staff-${providerId.slice(0, 8)}@example.invalid`)}, ${q(roleId)}, true, 'active', 'en', now(), now());
         INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender,
           registration_branch_id, status, email, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(patientId)}, '1', 'Test Person', ${q(phone)}, '1990-01-01', 'female',
           ${q(branchId)}, 'active', ${q(email)}, now(), now());`);
  return { clinicId, phone, branchId, providerId, staffUserId, patientId, email };
}

export function seedAppointment(
  w: World,
  o: { startsAt?: Date; createdAt?: Date; status?: string } = {},
): { id: string; startsAt: Date } {
  const id = randomUUID();
  const startsAt = o.startsAt ?? new Date(Date.now() + 3 * 86_400_000);
  const createdAt = o.createdAt ?? new Date(startsAt.getTime() - 7 * 86_400_000);
  const status = o.status ?? "booked";
  owner(`INSERT INTO appointments (clinic_id, id, branch_id, patient_id, provider_membership_id, starts_at,
           ends_at, status, overbooked, cancel_reason, created_by, created_at, updated_at)
         VALUES (${q(w.clinicId)}, ${q(id)}, ${q(w.branchId)}, ${q(w.patientId)}, ${q(w.providerId)},
           ${q(startsAt.toISOString())}, ${q(new Date(startsAt.getTime() + 1_800_000).toISOString())},
           ${q(status)}, false, ${status === "cancelled" ? "'other'" : "NULL"}, ${q(w.staffUserId)},
           ${q(createdAt.toISOString())}, now())`);
  return { id, startsAt };
}

/** A booked appointment and its confirmation, queued. */
export const booked = (language: "ar" | "en" = "en") => {
  const w = seedWorld(language);
  const appt = seedAppointment(w);
  return { w, appt, ...queueNotification(w, "booked", appt) };
};

let order = 0;

/** A ledger row and its outbox event, as the API writes them. */
export function queueNotification(
  w: World,
  kind: NotificationKind,
  subject: { id: string; startsAt?: Date },
  channel: "email" | "whatsapp" = "email",
): { notificationId: string; eventId: string } {
  const notificationId = randomUUID();
  const eventId = randomUUID();
  const visit = kind === "prescription";
  order += 1;
  owner(`INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id,
           subject_at, status, requested_by, created_at, updated_at)
         VALUES (${q(w.clinicId)}, ${q(notificationId)}, ${q(w.patientId)}, ${q(kind)}, ${q(channel)},
           ${visit ? "'visit'" : "'appointment'"}, ${q(subject.id)},
           ${subject.startsAt === undefined ? "NULL" : q(subject.startsAt.toISOString())}, 'queued',
           ${q(w.providerId)}, now(), now());
         INSERT INTO outbox_events (id, clinic_id, event_type, payload, created_at)
         VALUES (${q(eventId)}, ${q(w.clinicId)}, ${q(PATIENT_NOTIFICATION_REQUESTED)},
           ${q(JSON.stringify({ notificationId }))}::jsonb,
           now() - interval '1 hour' + ${order} * interval '1 millisecond')`);
  return { notificationId, eventId };
}

export function setSettings(clinicId: string, columns: Record<string, boolean>): void {
  const all = {
    email_enabled: true,
    whatsapp_enabled: false,
    booked: true,
    rescheduled: true,
    cancelled: true,
    reminder_day: true,
    reminder_2h: true,
    prescription: true,
    ...columns,
  };
  const names = Object.keys(all).join(", ");
  const values = Object.values(all).join(", ");
  owner(`INSERT INTO clinic_notification_settings (clinic_id, id, ${names}, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(randomUUID())}, ${values}, now(), now())`);
}

/** A clinic provider in one slot; its sealed secret names the slot, so the fake factory can tell them apart. */
export function seedProvider(
  clinicId: string,
  slot: "primary" | "fallback",
  o: { verified?: boolean; degraded?: boolean; replyTo?: string | null } = {},
): string {
  const id = randomUUID();
  const sealed = new SecretSealer(PROVIDER_KEY).seal(`re_fake_${slot}`, id);
  const replyTo = o.replyTo === undefined ? `${slot}-desk@example.invalid` : o.replyTo;
  owner(`INSERT INTO clinic_mail_providers (clinic_id, id, slot, kind, from_name, from_email, reply_to,
           sealed_credentials, verified_at, degraded_at, consecutive_failures, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(id)}, ${q(slot)}, 'resend', ${q(`Desk ${slot}`)},
           ${q(`${slot}@example.invalid`)}, ${replyTo === null ? "NULL" : q(replyTo)}, ${q(sealed)},
           ${o.verified === false ? "NULL" : "now()"}, ${o.degraded ? "now()" : "NULL"}, 0, now(), now())`);
  return id;
}

/** A signed visit with prescription lines sealed the way the API seals them (ADR-0028). */
export function seedSignedVisit(
  w: World,
  lines: {
    medicine: string;
    dose: string;
    frequency: string;
    duration: string;
    note: string | null;
  }[],
): string {
  const visitId = randomUUID();
  owner(`INSERT INTO visits (clinic_id, id, branch_id, patient_id, provider_membership_id, status, started_at,
           signed_at, signed_by, created_at, updated_at)
         VALUES (${q(w.clinicId)}, ${q(visitId)}, ${q(w.branchId)}, ${q(w.patientId)}, ${q(w.providerId)},
           'signed', now(), now(), ${q(w.providerId)}, now(), now())`);
  lines.forEach((line, position) => {
    const id = randomUUID();
    const seal = (field: string, value: string) =>
      cipher.seal(
        w.clinicId,
        { table: "visit_prescription_items", column: `${field}_enc`, rowId: id },
        value,
      );
    owner(`INSERT INTO visit_prescription_items (clinic_id, id, visit_id, position, medicine_enc, dose_enc,
             frequency_enc, duration_enc, note_enc, created_at)
           VALUES (${q(w.clinicId)}, ${q(id)}, ${q(visitId)}, ${position}, ${q(seal("medicine", line.medicine))},
             ${q(seal("dose", line.dose))}, ${q(seal("frequency", line.frequency))},
             ${q(seal("duration", line.duration))},
             ${line.note === null ? "NULL" : q(seal("note", line.note))}, now())`);
  });
  return visitId;
}

export interface LedgerState {
  status: string;
  provider_message_id: string | null;
  skip_reason: string | null;
  route: string | null;
  sent_at: string | null;
  attempts: number;
  last_error: string | null;
}

export const ledgerRow = (id: string): LedgerState =>
  ownerJson<LedgerState[]>(
    `SELECT status, provider_message_id, skip_reason, route, sent_at, attempts, last_error FROM patient_notifications
     WHERE id = ${q(id)}`,
  )[0]!;

/** A poller over the real store, with fake senders per slot, a fake platform and an optional WhatsApp. */
export function sendHarness(
  app: Database,
  outbox: DispatcherOutbox,
  withCipher = true,
  options: { whatsapp?: WhatsappSender | null; meta?: MetaSender; random?: () => number } = {},
) {
  const platform = new FakeMail();
  const slots = { primary: new FakeMail(), fallback: new FakeMail() };
  const opened: ClinicProviderCredentials[] = [];
  const clock = { t: new Date(), now: () => new Date(clock.t) };
  const { lines, logger } = captureLogs();
  const poller = new OutboxPoller({
    outbox,
    types: [PATIENT_NOTIFICATION_REQUESTED],
    now: () => clock.now(),
    intervalMs: 20,
    logger,
    handle: notificationDispatcher({
      store: new PgNotificationStore(app, { newId: randomUUID }),
      clinicMail: {
        sealer: new SecretSealer(PROVIDER_KEY),
        senders: {
          open: async (c) => {
            opened.push(c);
            const sender =
              c.kind === "resend" && c.apiKey === "re_fake_fallback"
                ? slots.fallback
                : slots.primary;
            return { sender, close: () => undefined };
          },
        },
        platformFrom: PLATFORM_FROM,
      },
      platform,
      whatsapp: options.whatsapp ?? null,
      ...(options.meta === undefined ? {} : { meta: options.meta }),
      whatsappSealer: new SecretSealer(PROVIDER_KEY),
      cipher: withCipher ? cipher : null,
      clock,
      ...(options.random === undefined ? {} : { random: options.random }),
      logger,
    }),
  });
  return { platform, slots, opened, clock, lines, poller };
}
