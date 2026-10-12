import { randomUUID } from "node:crypto";

import { createDatabase, createDispatcherOutbox } from "@eyadex/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  drain,
  eventRow,
  owner,
  parkLeftovers,
  urls,
} from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import {
  booked,
  ledgerRow,
  q,
  queueNotification,
  seedAppointment,
  seedProvider,
  seedWorld,
  sendHarness,
} from "./notification-fixtures.ts";

// Spec §3.3 on real PostgreSQL: the ledger row locked under the event's clinic as eyadex_app, the
// send-time re-read, the routes, and what lands on the ledger, the outbox and the audit log.
let app: ReturnType<typeof createDatabase>;
let outbox: ReturnType<typeof createDispatcherOutbox>;
const make = (withCipher = true) => sendHarness(app, outbox, withCipher);

beforeAll(() => {
  parkLeftovers();
  app = createDatabase({ url: urls().app, role: "eyadex_app", ids: { newId: randomUUID } });
  outbox = createDispatcherOutbox({ url: urls().dispatcher });
});
afterEach(parkLeftovers);
afterAll(async () => {
  await Promise.all([app.close(), outbox.close()]);
});

describe("patient.notification_requested — send", () => {
  it("sends through the verified primary with the clinic's from, and records the route", async () => {
    const h = make();
    const { w, notificationId, eventId } = booked();
    seedProvider(w.clinicId, "primary");
    await drain(h.poller);
    expect(h.platform.sent).toHaveLength(0);
    expect(h.slots.primary.sent).toHaveLength(1);
    const message = h.slots.primary.sent[0]!;
    expect(message.to).toBe(w.email);
    expect(message.from).toEqual({ name: "Desk primary", address: "primary@example.invalid" });
    expect(message.idempotencyKey).toBe(eventId);
    expect(message.subject).toContain("Al Noor <Clinic>");
    expect(message.text).toContain("Salmiya");
    expect(message.text).toContain("Dr. Huda");
    const row = ledgerRow(notificationId);
    expect(row).toMatchObject({ status: "sent", route: "primary", skip_reason: null });
    expect(row.sent_at).not.toBeNull();
    expect(eventRow(eventId).dispatched_at).not.toBeNull();
    // The log line carries codes only.
    expect(h.lines.join("\n")).not.toContain(w.email);
  });

  it("no clinic provider → the platform on the clinic's behalf, in the patient's language", async () => {
    const h = make();
    const { w, notificationId } = booked("en");
    owner(`UPDATE patients SET message_language = 'ar' WHERE id = ${q(w.patientId)}`);
    await drain(h.poller);
    expect(h.platform.sent).toHaveLength(1);
    const message = h.platform.sent[0]!;
    expect(message.from).toEqual({ name: "عيادة النور", address: "noreply@example.invalid" });
    expect(message.replyTo).toBeUndefined();
    expect(message.html).toContain('dir="rtl"');
    expect(ledgerRow(notificationId)).toMatchObject({ status: "sent", route: "platform" });
  });

  it("primary certainly failed → fallback; both certainly failed → platform with the primary's reply-to", async () => {
    const h = make();
    const first = booked();
    const primaryId = seedProvider(first.w.clinicId, "primary");
    seedProvider(first.w.clinicId, "fallback");
    h.slots.primary.result = async () => ({ sent: false, error: "resend_500" });
    await drain(h.poller);
    expect(h.slots.fallback.sent).toHaveLength(1);
    expect(h.platform.sent).toHaveLength(0);
    expect(ledgerRow(first.notificationId)).toMatchObject({ status: "sent", route: "fallback" });
    // A definitive failure of the clinic's provider counts toward its degradation (ADR-0014).
    expect(
      owner(`SELECT consecutive_failures FROM clinic_mail_providers WHERE id = ${q(primaryId)}`),
    ).toBe("1");

    const second = queueNotification(first.w, "rescheduled", first.appt);
    h.slots.fallback.result = async () => ({ sent: false, error: "smtp_econnrefused" });
    await drain(h.poller);
    expect(h.platform.sent).toHaveLength(1);
    expect(h.platform.sent[0]!.replyTo).toBe("primary-desk@example.invalid");
    expect(h.platform.sent[0]!.from?.name).toBe("Al Noor <Clinic>");
    expect(ledgerRow(second.notificationId)).toMatchObject({ status: "sent", route: "platform" });
  });

  it("a timeout after DATA retries the same route and never falls through", async () => {
    const h = make();
    const { w, notificationId, eventId } = booked();
    const providerId = seedProvider(w.clinicId, "primary");
    seedProvider(w.clinicId, "fallback");
    h.slots.primary.result = async () => ({ sent: false, error: "smtp_timeout_after_data" });
    await drain(h.poller);
    expect(h.slots.fallback.sent).toHaveLength(0);
    expect(h.platform.sent).toHaveLength(0);
    expect(ledgerRow(notificationId)).toMatchObject({
      status: "queued",
      attempts: 1,
      last_error: `primary:smtp_timeout_after_data:${providerId}:1`,
    });
    const event = eventRow(eventId);
    expect(event.dispatched_at).toBeNull();
    expect(event.last_error).toBe(`primary:smtp_timeout_after_data:${providerId}:1`);

    h.slots.primary.result = async () => ({ sent: true, provider: "smtp", fallback: false });
    h.clock.t = new Date(h.clock.t.getTime() + 2 * 60_000);
    await drain(h.poller);
    expect(h.slots.primary.sent).toHaveLength(1);
    expect(h.slots.fallback.sent).toHaveLength(0);
    expect(ledgerRow(notificationId)).toMatchObject({ status: "sent", route: "primary" });
  });

  it("an ambiguous failure on the fallback resumes there: the primary is not tried again", async () => {
    const h = make();
    const { w, notificationId } = booked();
    seedProvider(w.clinicId, "primary");
    const providerId = seedProvider(w.clinicId, "fallback");
    h.slots.primary.result = async () => ({ sent: false, error: "resend_unreachable" });
    h.slots.fallback.result = async () => ({ sent: false, error: "resend_timeout" });
    await drain(h.poller);
    expect(ledgerRow(notificationId).last_error).toBe(`fallback:resend_timeout:${providerId}:1`);
    h.slots.primary.result = async () => ({ sent: true, provider: "resend", fallback: false });
    h.slots.fallback.result = async () => ({ sent: true, provider: "resend", fallback: false });
    h.clock.t = new Date(h.clock.t.getTime() + 2 * 60_000);
    await drain(h.poller);
    expect(h.slots.primary.sent).toHaveLength(0);
    expect(h.slots.fallback.sent).toHaveLength(1);
    expect(ledgerRow(notificationId)).toMatchObject({ status: "sent", route: "fallback" });
  });

  it("the fifth failure marks the row and the event failed", async () => {
    const h = make();
    const { notificationId, eventId } = booked();
    owner(`UPDATE outbox_events SET attempts = 4 WHERE id = ${q(eventId)}`);
    h.platform.result = async () => ({ sent: false, error: "resend_timeout" });
    await drain(h.poller);
    expect(ledgerRow(notificationId)).toMatchObject({
      status: "failed",
      attempts: 5,
      last_error: "platform:resend_timeout",
      route: null,
      sent_at: null,
    });
    expect(eventRow(eventId).failed_at).not.toBeNull();
  });

  it("the cancellation message goes out for a cancelled appointment", async () => {
    const h = make();
    const w = seedWorld();
    const appt = seedAppointment(w, { status: "cancelled" });
    const { notificationId } = queueNotification(w, "cancelled", appt);
    await drain(h.poller);
    expect(h.platform.sent[0]!.subject).toContain("cancelled");
    expect(ledgerRow(notificationId).status).toBe("sent");
  });

  it("a row that is no longer queued closes its event without a send", async () => {
    const h = make();
    const { notificationId, eventId } = booked();
    owner(
      `UPDATE patient_notifications SET status = 'skipped', skip_reason = 'no_email' WHERE id = ${q(notificationId)}`,
    );
    await drain(h.poller);
    expect(h.platform.sent).toHaveLength(0);
    expect(eventRow(eventId).dispatched_at).not.toBeNull();
  });

  it("never reads another clinic's ledger row (RLS): the event fails as missing", async () => {
    const h = make();
    const a = booked();
    const b = seedWorld();
    owner(`UPDATE outbox_events SET clinic_id = ${q(b.clinicId)} WHERE id = ${q(a.eventId)}`);
    await drain(h.poller);
    expect(h.platform.sent).toHaveLength(0);
    expect(eventRow(a.eventId)).toMatchObject({ last_error: "missing" });
    expect(ledgerRow(a.notificationId).status).toBe("queued");
  });
});
