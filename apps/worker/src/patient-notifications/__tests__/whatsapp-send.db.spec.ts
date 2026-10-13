import { randomUUID } from "node:crypto";

import { createDatabase, createDispatcherOutbox, sql } from "@eyadex/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  drain,
  eventRow,
  ownerJson,
  parkLeftovers,
  urls,
} from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import type { WhatsappSender } from "../ports/whatsapp-sender.ts";
import {
  ledgerRow,
  q,
  queueNotification,
  seedAppointment,
  seedSignedVisit,
  seedWorld,
  sendHarness,
  setSettings,
} from "./notification-fixtures.ts";
import {
  channelRow,
  FakeWhatsapp,
  FakeMetaSender,
  META_TOKEN,
  seedChannel,
} from "./whatsapp-fixtures.ts";

// Spec §7.1 on real PostgreSQL with a fake Evolution boundary: what goes out, what is skipped, what fails.
let app: ReturnType<typeof createDatabase>;
let outbox: ReturnType<typeof createDispatcherOutbox>;
const make = (whatsapp: WhatsappSender | null, meta?: FakeMetaSender) =>
  sendHarness(app, outbox, true, { whatsapp, ...(meta ? { meta } : {}), random: () => 0.5 });

beforeAll(() => {
  parkLeftovers();
  app = createDatabase({ url: urls().app, role: "eyadex_app", ids: { newId: randomUUID } });
  outbox = createDispatcherOutbox({ url: urls().dispatcher });
});
afterEach(parkLeftovers);
afterAll(async () => {
  await Promise.all([app.close(), outbox.close()]);
});

/** A clinic with WhatsApp switched on and one booked appointment. */
function linkedClinic(language: "ar" | "en", channel: Parameters<typeof seedChannel>[1] = {}) {
  const w = seedWorld(language);
  setSettings(w.clinicId, { whatsapp_enabled: true });
  seedChannel(w.clinicId, channel);
  return { w, appt: seedAppointment(w) };
}

describe("WhatsApp send (spec §7.1)", () => {
  it("evolution: the email's plain text to 965<phone> through the clinic's instance; email goes on its own", async () => {
    const fake = new FakeWhatsapp();
    const h = make(fake);
    const { w, appt } = linkedClinic("en");
    const email = queueNotification(w, "booked", appt);
    const whatsapp = queueNotification(w, "booked", appt, "whatsapp");
    await drain(h.poller);

    expect(fake.calls).toEqual([
      {
        action: "text",
        instance: `eyadex-${w.clinicId}`,
        number: `965${w.phone}`,
        text: expect.stringContaining("Your appointment at Al Noor <Clinic> is booked."),
      },
    ]);
    expect(ledgerRow(whatsapp.notificationId)).toMatchObject({
      status: "sent",
      route: "evolution",
      provider_message_id: "evo.fake",
      attempts: 0,
      last_error: null,
    });
    expect(ledgerRow(email.notificationId)).toMatchObject({ status: "sent", route: "platform" });
    expect(h.platform.sent).toHaveLength(1);
    // The pace: the next message of this clinic waits 8 s + the injected jitter (0.5 × 4 s).
    const channel = channelRow(w.clinicId);
    expect(new Date(channel.next_send_at!).getTime()).toBe(h.clock.t.getTime() + 10_000);
    expect(channel.last_error).toBeNull();
    // Codes only in the log: never the number, never the text.
    const log = h.lines.join("\n");
    expect(log).not.toContain(w.phone);
    expect(log).not.toContain("Your appointment");
  });

  it("coexistence: the kind's Meta template with clinic, date, time, provider, branch in Arabic", async () => {
    const fake = new FakeMetaSender();
    const h = make(null, fake);
    const templates = { booked: { name: "appointment_booked", language: "ar" } };
    const { w, appt } = linkedClinic("ar", { transport: "coexistence", templates });
    const { notificationId } = queueNotification(w, "booked", appt, "whatsapp");
    await drain(h.poller);

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.action).toBe("template");
    if (call.action !== "template") return;
    expect(call.number).toBe(`965${w.phone}`);
    expect(call.credentials).toEqual({ phoneNumberId: "10000", accessToken: META_TOKEN });
    expect(call.template.name).toBe("appointment_booked");
    expect(call.template.language).toBe("ar");
    const [clinic, date, time, provider, branch, ...rest] = call.template.parameters;
    expect([clinic, provider, branch, rest]).toEqual([
      "عيادة النور",
      "Dr. Huda",
      "فرع السالمية",
      [],
    ]);
    expect(date).toMatch(/\d{4}/);
    expect(time).toMatch(/\d{1,2}:\d{2}/);
    expect(ledgerRow(notificationId)).toMatchObject({
      status: "sent",
      route: "coexistence",
      provider_message_id: "wamid.fake",
    });
  });

  it("coexistence prescription: the template's language (en_US) wins, lines on one line, audited", async () => {
    const fake = new FakeMetaSender();
    const h = make(null, fake);
    const templates = { prescription: { name: "rx_lines", language: "en_US" } };
    const { w } = linkedClinic("ar", { transport: "coexistence", templates });
    const visitId = seedSignedVisit(w, [
      { medicine: "Paracetamol", dose: "500 mg", frequency: "3x", duration: "5 days", note: null },
      {
        medicine: "Vitamin D",
        dose: "1000 IU",
        frequency: "daily",
        duration: "1 month",
        note: null,
      },
    ]);
    const { notificationId } = queueNotification(w, "prescription", { id: visitId }, "whatsapp");
    await drain(h.poller);

    const call = fake.calls[0];
    expect(call?.action === "template" && call.template.parameters).toEqual([
      "Al Noor <Clinic>",
      "Dr. Huda",
      "Paracetamol — 500 mg — 3x — 5 days • Vitamin D — 1000 IU — daily — 1 month",
    ]);
    expect(ledgerRow(notificationId)).toMatchObject({
      status: "sent",
      route: "coexistence",
      provider_message_id: "wamid.fake",
    });
    const audit = ownerJson<{ action: string }[]>(
      `SELECT action FROM audit_log WHERE clinic_id = ${q(w.clinicId)} AND entity_id = ${q(w.patientId)}`,
    );
    expect(audit.map((a) => a.action)).toEqual(["patient.prescription_sent"]);
  });

  it("template_missing: coexistence without a template for the kind sends nothing", async () => {
    const fake = new FakeMetaSender();
    const h = make(null, fake);
    const templates = { booked: null, reminder_day: { name: "day_before", language: "en" } };
    const { w, appt } = linkedClinic("en", { transport: "coexistence", templates });
    const { notificationId } = queueNotification(w, "booked", appt, "whatsapp");
    await drain(h.poller);
    expect(fake.calls).toHaveLength(0);
    expect(ledgerRow(notificationId)).toMatchObject({
      status: "skipped",
      skip_reason: "template_missing",
    });
  });

  it.each([
    ["Evolution is not configured in the worker", null, {}],
    ["the channel is still pending", "fake", { status: "pending" as const }],
    ["the channel was disconnected", "fake", { status: "disconnected" as const }],
    [
      "the link was undone and its transport cleared",
      "fake",
      { status: "disconnected" as const, transport: null },
    ],
  ])("whatsapp_disconnected: %s", async (_case, sender, channel) => {
    const fake = new FakeWhatsapp();
    const h = make(sender === null ? null : fake);
    const { w, appt } = linkedClinic("en", channel);
    const { notificationId } = queueNotification(w, "booked", appt, "whatsapp");
    await drain(h.poller);
    expect(fake.calls).toHaveLength(0);
    expect(ledgerRow(notificationId)).toMatchObject({
      status: "skipped",
      skip_reason: "whatsapp_disconnected",
    });
  });

  it("whatsapp_disconnected when the clinic never linked a number; setting_off when WhatsApp is off", async () => {
    const fake = new FakeWhatsapp();
    const h = make(fake);
    const unlinked = seedWorld();
    setSettings(unlinked.clinicId, { whatsapp_enabled: true });
    const a = queueNotification(unlinked, "booked", seedAppointment(unlinked), "whatsapp");
    const off = seedWorld();
    seedChannel(off.clinicId);
    const b = queueNotification(off, "booked", seedAppointment(off), "whatsapp");
    await drain(h.poller);
    expect(fake.calls).toHaveLength(0);
    expect(ledgerRow(a.notificationId).skip_reason).toBe("whatsapp_disconnected");
    expect(ledgerRow(b.notificationId).skip_reason).toBe("setting_off");
  });

  it("a send failure retries on the N1 schedule with a code; no fallback to email", async () => {
    const fake = new FakeWhatsapp();
    fake.result = async () => ({ sent: false, error: "evo_5xx" });
    const h = make(fake);
    const { w, appt } = linkedClinic("en");
    const { notificationId, eventId } = queueNotification(w, "booked", appt, "whatsapp");
    await drain(h.poller);

    expect(ledgerRow(notificationId)).toMatchObject({
      status: "queued",
      attempts: 1,
      last_error: "evolution:evo_5xx",
    });
    const event = eventRow(eventId);
    expect(event).toMatchObject({ attempts: 1, last_error: "evolution:evo_5xx", failed_at: null });
    expect(new Date(event.next_attempt_at!).getTime()).toBe(h.clock.t.getTime() + 60_000);
    expect(channelRow(w.clinicId).last_error).toBe("evo_5xx");
    expect(h.platform.sent).toHaveLength(0);
  });

  it("a number that is not on WhatsApp fails at once: no retry can fix it", async () => {
    const fake = new FakeWhatsapp();
    fake.result = async () => ({ sent: false, error: "evo_not_on_whatsapp" });
    const h = make(fake);
    const { w, appt } = linkedClinic("en");
    const { notificationId, eventId } = queueNotification(w, "booked", appt, "whatsapp");
    await drain(h.poller);
    expect(ledgerRow(notificationId)).toMatchObject({
      status: "failed",
      last_error: "evolution:evo_not_on_whatsapp",
    });
    expect(eventRow(eventId).failed_at).not.toBeNull();
  });

  it("isolation: a clinic without a channel never sends through another clinic's link", async () => {
    const fake = new FakeWhatsapp();
    const h = make(fake);
    const a = seedWorld();
    setSettings(a.clinicId, { whatsapp_enabled: true });
    const { w: b, appt: bAppt } = linkedClinic("en");
    const fromA = queueNotification(a, "booked", seedAppointment(a), "whatsapp");
    const fromB = queueNotification(b, "booked", bAppt, "whatsapp");
    await drain(h.poller);
    expect(ledgerRow(fromA.notificationId).skip_reason).toBe("whatsapp_disconnected");
    expect(ledgerRow(fromB.notificationId).status).toBe("sent");
    expect(fake.calls.map((c) => [c.instance, c.number])).toEqual([
      [`eyadex-${b.clinicId}`, `965${b.phone}`],
    ]);
    // Under RLS the clinic without a link does not even see that another clinic has one.
    const seen = (await app.withTenant(a.clinicId, (tx) =>
      tx.execute(sql`SELECT count(*)::int AS n FROM clinic_whatsapp_channels`),
    )) as unknown as { n: number }[];
    expect(seen).toEqual([{ n: 0 }]);
  });
});
