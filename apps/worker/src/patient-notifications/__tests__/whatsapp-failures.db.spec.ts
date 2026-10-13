import { randomUUID } from "node:crypto";
import { createDatabase, createDispatcherOutbox } from "@eyadex/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  drain,
  eventRow,
  parkLeftovers,
  urls,
} from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import {
  ledgerRow,
  queueNotification,
  seedAppointment,
  seedWorld,
  sendHarness,
  setSettings,
} from "./notification-fixtures.ts";
import { channelRow, FakeMetaSender, FakeWhatsapp, seedChannel } from "./whatsapp-fixtures.ts";
import { EvolutionWhatsappSender } from "../whatsapp/evolution-whatsapp-sender.ts";

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
      const later = queueNotification(w, "rescheduled", seedAppointment(w), "whatsapp");
      await drain(h.poller);
      expect(ledgerRow(later.notificationId)).toMatchObject({
        status: "skipped",
        skip_reason: "whatsapp_disconnected",
      });
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
