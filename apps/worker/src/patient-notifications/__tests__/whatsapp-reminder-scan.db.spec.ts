import { randomUUID } from "node:crypto";

import { createDatabase, type Database } from "@eyadex/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  owner,
  ownerJson,
  parkLeftovers,
  urls,
} from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import { PATIENT_NOTIFICATION_REQUESTED } from "../domain/notification-event.ts";
import { PgReminderQueue } from "../persistence/pg-reminder-queue.ts";
import { q, seedAppointment, seedWorld, setSettings, type World } from "./notification-fixtures.ts";
import { seedChannel } from "./whatsapp-fixtures.ts";

// Spec §7.1: the reminder scan queues a WhatsApp row next to the email row when WhatsApp is on and the
// clinic's channel is connected — same windows, once per start per channel.
const HOUR = 3_600_000;
const ids = { newId: randomUUID };
let app: Database;

beforeAll(() => {
  parkLeftovers();
  app = createDatabase({ url: urls().app, role: "eyadex_app", ids });
});
afterEach(parkLeftovers);
afterAll(async () => {
  await app.close();
});

const NOW = new Date();
const inHours = (h: number) => new Date(NOW.getTime() + h * HOUR);

function clinic(settings: Record<string, boolean>, channel?: Parameters<typeof seedChannel>[1]) {
  const w: World = seedWorld();
  owner(`INSERT INTO clinic_features (clinic_id, id, module, enabled, updated_at)
         VALUES (${q(w.clinicId)}, ${q(randomUUID())}, 'appointments', true, now())`);
  setSettings(w.clinicId, settings);
  if (channel !== undefined) seedChannel(w.clinicId, channel);
  return w;
}

const run = (clinicId: string) => new PgReminderQueue(app, ids, 1).queue(clinicId, () => NOW);
const rows = (clinicId: string) =>
  ownerJson<{ id: string; kind: string; channel: string }[]>(
    `SELECT id, kind, channel FROM patient_notifications WHERE clinic_id = ${q(clinicId)}
     ORDER BY channel, kind`,
  );
const eventIds = (clinicId: string) =>
  ownerJson<{ id: string }[]>(
    `SELECT payload->>'notificationId' AS id FROM outbox_events WHERE clinic_id = ${q(clinicId)}
     AND event_type = ${q(PATIENT_NOTIFICATION_REQUESTED)}`,
  ).map((e) => e.id);

describe("appointment reminder scan with WhatsApp (spec §7.1)", () => {
  it("queues the day reminder on both channels once each, one event per row", async () => {
    const w = clinic({ whatsapp_enabled: true }, {});
    seedAppointment(w, { startsAt: inHours(10), createdAt: inHours(-72) });
    expect(await run(w.clinicId)).toBe(2);
    expect(await run(w.clinicId)).toBe(0);
    const queued = rows(w.clinicId);
    expect(queued.map((r) => [r.channel, r.kind])).toEqual([
      ["email", "reminder_day"],
      ["whatsapp", "reminder_day"],
    ]);
    expect(eventIds(w.clinicId).sort()).toEqual(queued.map((r) => r.id).sort());
  });

  it("WhatsApp only: email off, the 2 h reminder still goes on WhatsApp", async () => {
    const w = clinic({ email_enabled: false, whatsapp_enabled: true }, {});
    seedAppointment(w, { startsAt: inHours(1), createdAt: inHours(-30) });
    expect(await run(w.clinicId)).toBe(1);
    expect(rows(w.clinicId).map((r) => [r.channel, r.kind])).toEqual([["whatsapp", "reminder_2h"]]);
  });

  it.each([
    ["the channel is not connected", { whatsapp_enabled: true }, { status: "pending" as const }],
    ["the clinic never linked a number", { whatsapp_enabled: true }, undefined],
    ["WhatsApp is switched off", { whatsapp_enabled: false }, {}],
  ])("email only when %s", async (_case, settings, channel) => {
    const w = clinic(settings, channel);
    seedAppointment(w, { startsAt: inHours(10), createdAt: inHours(-72) });
    expect(await run(w.clinicId)).toBe(1);
    expect(rows(w.clinicId).map((r) => r.channel)).toEqual(["email"]);
  });

  it("the reminder switched off stops both channels", async () => {
    const w = clinic({ whatsapp_enabled: true, reminder_day: false }, {});
    seedAppointment(w, { startsAt: inHours(10), createdAt: inHours(-72) });
    expect(await run(w.clinicId)).toBe(0);
  });

  it("isolation: another clinic's connected channel does not open WhatsApp here", async () => {
    clinic({ whatsapp_enabled: true }, {});
    const w = clinic({ whatsapp_enabled: true });
    seedAppointment(w, { startsAt: inHours(10), createdAt: inHours(-72) });
    expect(await run(w.clinicId)).toBe(1);
    expect(rows(w.clinicId).map((r) => r.channel)).toEqual(["email"]);
  });
});
