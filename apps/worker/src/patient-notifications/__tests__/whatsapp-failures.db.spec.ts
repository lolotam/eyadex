import { randomBytes, randomUUID } from "node:crypto";
import { SYSTEM_ACTOR_ID } from "@eyadex/contracts/audit";
import { createDatabase, createDispatcherOutbox } from "@eyadex/db";
import { SecretSealer } from "@eyadex/secrets";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  drain,
  eventRow,
  ownerJson,
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
import { channelRow, FakeMetaSender, FakeWhatsapp, seedChannel } from "./whatsapp-fixtures.ts";
import { EvolutionWhatsappSender } from "../whatsapp/evolution-whatsapp-sender.ts";
import { lockWhatsappChannel } from "../persistence/pg-channel-lock.ts";

let app: ReturnType<typeof createDatabase>;
let outbox: ReturnType<typeof createDispatcherOutbox>;
beforeAll(() => {
  parkLeftovers();
  app = createDatabase({
    url: urls().app,
    role: "eyadex_app",
    ids: { newId: randomUUID },
    transactionTimeoutMs: 30_000,
  });
  outbox = createDispatcherOutbox({ url: urls().dispatcher });
});
afterEach(parkLeftovers);
afterAll(async () => {
  await Promise.all([app.close(), outbox.close()]);
});
const queued = () => {
  const w = seedWorld();
  setSettings(w.clinicId, { whatsapp_enabled: true });
  seedChannel(w.clinicId);
  return { w, ...queueNotification(w, "booked", seedAppointment(w), "whatsapp") };
};

describe("WhatsApp final failures", () => {
  it("a wrong coexistence seal key fails the ledger and finishes the event without retry", async () => {
    const w = seedWorld();
    setSettings(w.clinicId, { whatsapp_enabled: true });
    seedChannel(w.clinicId, {
      transport: "coexistence",
      templates: { booked: { name: "booking_ok", language: "en" } },
    });
    const meta = new FakeMetaSender();
    const h = sendHarness(app, outbox, true, {
      meta,
      whatsappSealer: new SecretSealer(randomBytes(32).toString("base64")),
    });
    const { notificationId, eventId } = queueNotification(
      w,
      "booked",
      seedAppointment(w),
      "whatsapp",
    );
    await drain(h.poller);
    expect(ledgerRow(notificationId)).toMatchObject({
      status: "failed",
      attempts: 1,
      last_error: "coexistence:seal_unreadable",
    });
    expect(eventRow(eventId)).toMatchObject({
      attempts: 1,
      last_error: "coexistence:seal_unreadable",
      next_attempt_at: null,
    });
    expect(eventRow(eventId).failed_at).not.toBeNull();
    expect(meta.calls).toHaveLength(0);
    h.clock.t = new Date(h.clock.t.getTime() + 86_400_000);
    expect(await h.poller.runOnce()).toBe(false);
    expect(ledgerRow(notificationId).attempts).toBe(1);
  });

  it("rolls back the disconnection and its audit together", async () => {
    const w = seedWorld();
    seedChannel(w.clinicId);
    await expect(
      app.withTenant(w.clinicId, async (tx) => {
        const channel = await lockWhatsappChannel(tx, w.clinicId, { newId: randomUUID });
        expect(channel.kind).toBe("locked");
        if (channel.kind === "locked") await channel.disconnect(new Date());
        throw new Error("rollback probe");
      }),
    ).rejects.toThrow("rollback probe");
    expect(channelRow(w.clinicId).status).toBe("connected");
    expect(
      ownerJson<unknown[]>(
        `SELECT id FROM audit_log WHERE clinic_id = ${q(w.clinicId)} AND action = 'clinic.whatsapp_disconnected'`,
      ),
    ).toEqual([]);
  });
  it.each(["evo_timeout", "evo_rejected", "evo_unauthorized", "evo_not_on_whatsapp"])(
    "%s is never retried",
    async (error) => {
      const fake = new FakeWhatsapp();
      fake.result = async () => ({ sent: false, error });
      const h = sendHarness(app, outbox, true, { whatsapp: fake });
      const { notificationId, eventId } = queued();
      await drain(h.poller);
      expect(ledgerRow(notificationId)).toMatchObject({
        status: "failed",
        last_error: `evolution:${error}`,
      });
      expect(eventRow(eventId).failed_at).not.toBeNull();
      expect(fake.calls).toHaveLength(1);
    },
  );
  it.each(["evo_not_connected", "closed_top", "closed_nested"])(
    "%s disconnects and later rows skip",
    async (shape) => {
      const fake = new FakeWhatsapp();
      fake.result = async () => ({ sent: false, error: "evo_not_connected" });
      const sender =
        shape === "evo_not_connected"
          ? fake
          : new EvolutionWhatsappSender({
              url: "http://evolution.test:8080",
              apiKey: randomUUID(),
              fetch: (async () =>
                new Response(
                  JSON.stringify(
                    shape === "closed_top"
                      ? { message: "Connection Closed" }
                      : { response: { message: ["Connection Closed"] } },
                  ),
                  { status: 503 },
                )) as typeof fetch,
            });
      const h = sendHarness(app, outbox, true, { whatsapp: sender });
      const { w, notificationId } = queued();
      await drain(h.poller);
      expect(ledgerRow(notificationId)).toMatchObject({
        status: "failed",
        last_error: "evolution:evo_not_connected",
      });
      expect(channelRow(w.clinicId)).toMatchObject({
        status: "disconnected",
        last_error: "evo_not_connected",
        connected_at: null,
      });
      const audits = () =>
        ownerJson<Record<string, unknown>[]>(
          `SELECT actor_user_id, category, entity_type, entity_id, branch_id, details FROM audit_log
         WHERE clinic_id = ${q(w.clinicId)} AND action = 'clinic.whatsapp_disconnected'`,
        );
      expect(audits()).toEqual([
        {
          actor_user_id: SYSTEM_ACTOR_ID,
          category: "administrative",
          entity_type: "clinic",
          entity_id: w.clinicId,
          branch_id: null,
          details: { transport: "evolution", reason: "send_not_connected" },
        },
      ]);
      // A repeat of the disconnect itself must also be a no-op, not only a skipped send.
      await app.withTenant(w.clinicId, async (tx) => {
        const channel = await lockWhatsappChannel(tx, w.clinicId, { newId: randomUUID });
        expect(channel.kind).toBe("locked");
        if (channel.kind === "locked") await channel.disconnect(new Date());
      });
      const later = queueNotification(w, "rescheduled", seedAppointment(w), "whatsapp");
      await drain(h.poller);
      expect(ledgerRow(later.notificationId)).toMatchObject({
        status: "skipped",
        skip_reason: "whatsapp_disconnected",
      });
      expect(audits()).toHaveLength(1);
    },
  );
  it.each([
    "meta_timeout",
    "meta_unauthorized",
    "meta_template",
    "meta_not_on_whatsapp",
    "meta_rejected",
    "meta_rate_limited",
    "meta_unreachable",
    "meta_5xx",
  ])("Meta %s follows its retry policy without Evolution", async (error) => {
    const w = seedWorld();
    setSettings(w.clinicId, { whatsapp_enabled: true });
    seedChannel(w.clinicId, {
      transport: "coexistence",
      templates: { booked: { name: "booking_ok", language: "en" } },
    });
    const meta = new FakeMetaSender();
    meta.result = async () => ({ sent: false, error });
    const h = sendHarness(app, outbox, true, { whatsapp: null, meta });
    const { notificationId, eventId } = queueNotification(
      w,
      "booked",
      seedAppointment(w),
      "whatsapp",
    );
    await drain(h.poller);
    const retry = ["meta_rate_limited", "meta_unreachable", "meta_5xx"].includes(error);
    expect(ledgerRow(notificationId)).toMatchObject({
      status: retry ? "queued" : "failed",
      last_error: `coexistence:${error}`,
    });
    expect(eventRow(eventId).failed_at === null).toBe(retry);
    expect(meta.calls).toHaveLength(1);
  });
});
