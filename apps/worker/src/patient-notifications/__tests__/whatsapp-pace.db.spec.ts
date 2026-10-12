import { randomUUID } from "node:crypto";

import { createDatabase, createDispatcherOutbox, sql } from "@eyadex/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  drain,
  eventRow,
  owner,
  parkLeftovers,
  urls,
} from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import {
  ledgerRow,
  q,
  queueNotification,
  seedAppointment,
  seedWorld,
  sendHarness,
  setSettings,
} from "./notification-fixtures.ts";
import { channelRow, FakeWhatsapp, seedChannel } from "./whatsapp-fixtures.ts";

// Spec §7.1, the per-clinic pace: one message at a time under the channel row's lock, 8 s + 0–4 s apart.
// Waiting for the turn is a `deferred` outcome: it never counts as an attempt and keeps last_error.
let app: ReturnType<typeof createDatabase>;
let outbox: ReturnType<typeof createDispatcherOutbox>;

beforeAll(() => {
  parkLeftovers();
  app = createDatabase({ url: urls().app, role: "eyadex_app", ids: { newId: randomUUID } });
  outbox = createDispatcherOutbox({ url: urls().dispatcher });
});
afterEach(parkLeftovers);
afterAll(async () => {
  await Promise.all([app.close(), outbox.close()]);
});

function linkedClinic() {
  const w = seedWorld("en");
  setSettings(w.clinicId, { whatsapp_enabled: true });
  seedChannel(w.clinicId);
  return w;
}

const harness = (fake: FakeWhatsapp) =>
  sendHarness(app, outbox, true, { whatsapp: fake, random: () => 0 });

describe("WhatsApp pace (spec §7.1)", () => {
  it("the second message of a clinic waits for its turn without counting an attempt", async () => {
    const fake = new FakeWhatsapp();
    const h = harness(fake);
    const w = linkedClinic();
    const appt = seedAppointment(w);
    queueNotification(w, "booked", appt, "whatsapp");
    const second = queueNotification(w, "reminder_day", appt, "whatsapp");
    await drain(h.poller);

    expect(fake.calls).toHaveLength(1);
    const turn = new Date(channelRow(w.clinicId).next_send_at!);
    expect(turn.getTime()).toBe(h.clock.t.getTime() + 8_000);
    const waiting = eventRow(second.eventId);
    expect(waiting).toMatchObject({ attempts: 0, last_error: null, dispatched_at: null });
    expect(new Date(waiting.next_attempt_at!)).toEqual(turn);
    expect(ledgerRow(second.notificationId)).toMatchObject({ status: "queued", attempts: 0 });

    // Not claimable before its turn; sent once the clock reaches it.
    h.clock.t = new Date(turn.getTime() - 1);
    await drain(h.poller);
    expect(fake.calls).toHaveLength(1);
    h.clock.t = turn;
    await drain(h.poller);
    expect(fake.calls).toHaveLength(2);
    expect(ledgerRow(second.notificationId)).toMatchObject({ status: "sent", attempts: 0 });
  });

  it("another clinic's pace never holds this clinic back", async () => {
    const fake = new FakeWhatsapp();
    const h = harness(fake);
    const busy = linkedClinic();
    owner(`UPDATE clinic_whatsapp_channels SET next_send_at = now() + interval '1 hour'
           WHERE clinic_id = ${q(busy.clinicId)}`);
    const free = linkedClinic();
    const held = queueNotification(busy, "booked", seedAppointment(busy), "whatsapp");
    const sent = queueNotification(free, "booked", seedAppointment(free), "whatsapp");
    await drain(h.poller);
    expect(fake.calls.map((c) => c.instance)).toEqual([`eyadex-${free.clinicId}`]);
    expect(ledgerRow(sent.notificationId).status).toBe("sent");
    expect(eventRow(held.eventId)).toMatchObject({ attempts: 0, last_error: null });
  });

  it("a retry that must wait for the turn keeps its attempt count and its last error", async () => {
    const fake = new FakeWhatsapp();
    fake.result = async () => ({ sent: false, error: "evo_unreachable" });
    const h = harness(fake);
    const w = linkedClinic();
    const { eventId, notificationId } = queueNotification(
      w,
      "booked",
      seedAppointment(w),
      "whatsapp",
    );
    await drain(h.poller);
    const failed = eventRow(eventId);
    expect(failed).toMatchObject({ attempts: 1, last_error: "evolution:evo_unreachable" });

    // The retry is due, but another send pushed the clinic's turn past it.
    const retryAt = new Date(failed.next_attempt_at!);
    const turn = new Date(retryAt.getTime() + 5_000);
    owner(`UPDATE clinic_whatsapp_channels SET next_send_at = ${q(turn.toISOString())}
           WHERE clinic_id = ${q(w.clinicId)}`);
    h.clock.t = retryAt;
    await drain(h.poller);
    const deferred = eventRow(eventId);
    expect(deferred).toMatchObject({ attempts: 1, last_error: "evolution:evo_unreachable" });
    expect(new Date(deferred.next_attempt_at!)).toEqual(turn);
    expect(ledgerRow(notificationId)).toMatchObject({ status: "queued", attempts: 1 });
    expect(fake.calls).toHaveLength(1);
  });

  it("a channel locked by a send in flight defers one pace instead of waiting on the lock", async () => {
    const fake = new FakeWhatsapp();
    const h = harness(fake);
    const w = linkedClinic();
    const { eventId } = queueNotification(w, "booked", seedAppointment(w), "whatsapp");
    let release!: () => void;
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holder = app.withTenant(w.clinicId, async (tx) => {
      await tx.execute(
        sql`SELECT id FROM clinic_whatsapp_channels WHERE clinic_id = ${w.clinicId} FOR UPDATE`,
      );
      locked();
      await new Promise<void>((resolve) => (release = resolve));
    });
    await isLocked;
    try {
      expect(await h.poller.runOnce()).toBe(true);
    } finally {
      release();
      await holder;
    }
    expect(fake.calls).toHaveLength(0);
    const event = eventRow(eventId);
    expect(event).toMatchObject({ attempts: 0, last_error: null, dispatched_at: null });
    expect(new Date(event.next_attempt_at!).getTime()).toBe(h.clock.t.getTime() + 8_000);
  });
});
