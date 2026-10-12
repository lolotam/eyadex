import { randomUUID } from "node:crypto";

import { createDatabase, createDispatcherOutbox, type Database } from "@eyadex/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  drain,
  owner,
  ownerJson,
  parkLeftovers,
  urls,
} from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import { PgReminderQueue } from "../persistence/pg-reminder-queue.ts";
import {
  ledgerRow,
  q,
  seedAppointment,
  seedProvider,
  seedWorld,
  sendHarness,
} from "./notification-fixtures.ts";

let app: Database;
let outbox: ReturnType<typeof createDispatcherOutbox>;
const NOW = new Date();
const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

beforeAll(() => {
  parkLeftovers();
  app = createDatabase({ url: urls().app, role: "eyadex_app", ids: { newId: randomUUID } });
  outbox = createDispatcherOutbox({ url: urls().dispatcher });
});
afterEach(parkLeftovers);
afterAll(async () => Promise.all([app.close(), outbox.close()]));

function setup() {
  const world = seedWorld();
  owner(`INSERT INTO clinic_features (clinic_id, id, module, enabled, updated_at)
         VALUES (${q(world.clinicId)}, ${q(randomUUID())}, 'appointments', true, now())`);
  return world;
}

const ledger = (clinicId: string) =>
  ownerJson<{ id: string; kind: string; subject_at: string }[]>(
    `SELECT id, kind, to_json(subject_at) #>> '{}' AS subject_at FROM patient_notifications
     WHERE clinic_id = ${q(clinicId)}`,
  );

describe("reminder scan regressions on real PostgreSQL", () => {
  it("sends a scanned reminder through primary using the appointment creator user id", async () => {
    const world = setup();
    const appointment = seedAppointment(world, { startsAt: at(10), createdAt: at(-72) });
    // The API writes a user id, so deliberately differing ids catch an accidental membership join.
    owner(
      `UPDATE appointments SET created_by = ${q(world.staffUserId)} WHERE id = ${q(appointment.id)}`,
    );
    seedProvider(world.clinicId, "primary");
    expect(
      await new PgReminderQueue(app, { newId: randomUUID }).queue(world.clinicId, () => NOW),
    ).toBe(1);
    const h = sendHarness(app, outbox);
    await drain(h.poller);
    expect(h.slots.primary.sent).toHaveLength(1);
    expect(h.platform.sent).toHaveLength(0);
    expect(ledgerRow(ledger(world.clinicId)[0]!.id)).toMatchObject({
      status: "sent",
      route: "primary",
    });
  });

  it.each(["outside_window", "wrong_window", "cancelled"] as const)(
    "revalidates a candidate changed to %s before ledger insertion",
    async (change) => {
      const world = setup();
      const appointment = seedAppointment(world, { startsAt: at(10), createdAt: at(-72) });
      let changed = false;
      const ids = {
        newId: () => {
          if (!changed) {
            changed = true;
            // The id is allocated after the candidate read and before INSERT: this gives the
            // competing reschedule a deterministic commit point without replacing PostgreSQL.
            if (change === "cancelled") {
              owner(`UPDATE appointments SET status = 'cancelled', cancel_reason = 'other'
                     WHERE id = ${q(appointment.id)}`);
            } else {
              const start = at(change === "outside_window" ? 48 : 1);
              owner(`UPDATE appointments SET starts_at = ${q(start.toISOString())},
                       ends_at = ${q(new Date(start.getTime() + 1_800_000).toISOString())}
                     WHERE id = ${q(appointment.id)}`);
            }
          }
          return randomUUID();
        },
      };
      expect(await new PgReminderQueue(app, ids).queue(world.clinicId, () => NOW)).toBe(0);
      expect(ledger(world.clinicId)).toHaveLength(0);

      if (change !== "cancelled") {
        const later = change === "outside_window" ? at(30) : NOW;
        expect(
          await new PgReminderQueue(app, { newId: randomUUID }).queue(world.clinicId, () => later),
        ).toBe(1);
        expect(ledger(world.clinicId)[0]!.kind).toBe(
          change === "outside_window" ? "reminder_day" : "reminder_2h",
        );
      }
    },
  );
});
