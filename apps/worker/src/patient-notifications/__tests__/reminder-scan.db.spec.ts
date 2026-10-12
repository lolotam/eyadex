import { randomUUID } from "node:crypto";

import { createDatabase, type Database } from "@eyadex/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  captureLogs,
  owner,
  ownerJson,
  parkLeftovers,
  urls,
} from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import { PATIENT_NOTIFICATION_REQUESTED } from "../domain/notification-event.ts";
import { PgReminderClinicFinder, PgReminderQueue } from "../persistence/pg-reminder-queue.ts";
import { AppointmentReminderScanner } from "../scan-appointment-reminders.ts";
import { q, seedAppointment, seedWorld, setSettings, type World } from "./notification-fixtures.ts";

// Spec §3.2 on real PostgreSQL: the clinic walk on eyadex_platform, the ledger and its events on
// eyadex_app under RLS, once per appointment start.
const HOUR = 3_600_000;
const ids = { newId: randomUUID };
let app: Database;
let platform: Database;

beforeAll(async () => {
  parkLeftovers();
  app = createDatabase({ url: urls().app, role: "eyadex_app", ids });
  const url = process.env["EYADEX_TEST_PLATFORM_URL"];
  if (!url) throw new Error("EYADEX_TEST_PLATFORM_URL is not set");
  platform = createDatabase({ url, role: "eyadex_platform", ids });
});
afterEach(parkLeftovers);
afterAll(async () => {
  await Promise.all([app.close(), platform.close()]);
});

const NOW = new Date();
const inHours = (h: number) => new Date(NOW.getTime() + h * HOUR);

function withAppointments(world = seedWorld()): World {
  owner(`INSERT INTO clinic_features (clinic_id, id, module, enabled, updated_at)
         VALUES (${q(world.clinicId)}, ${q(randomUUID())}, 'appointments', true, now())`);
  return world;
}

type Row = { kind: string; subject_id: string; subject_at: string; requested_by: string | null };
const ledger = (clinicId: string) =>
  ownerJson<(Row & { id: string })[]>(
    `SELECT id, kind, subject_id, to_json(subject_at) #>> '{}' AS subject_at, requested_by
     FROM patient_notifications WHERE clinic_id = ${q(clinicId)} ORDER BY created_at, kind`,
  );
const events = (clinicId: string) =>
  ownerJson<{ payload: { notificationId: string } }[]>(
    `SELECT payload FROM outbox_events WHERE clinic_id = ${q(clinicId)}
     AND event_type = ${q(PATIENT_NOTIFICATION_REQUESTED)}`,
  );

// pageSize 1: every clinic and appointment goes through the cursor, not just the first page.
const queue = () => new PgReminderQueue(app, ids, 1);
const run = (clinicId: string, at = NOW) => queue().queue(clinicId, () => at);

describe("appointment reminder scan (spec §3.2)", () => {
  it("queues the day reminder and the 2 h reminder once each, with one event per row", async () => {
    const w = withAppointments();
    const day = seedAppointment(w, { startsAt: inHours(10), createdAt: inHours(-72) });
    const soon = seedAppointment(w, { startsAt: inHours(1), createdAt: inHours(-30) });
    expect(await run(w.clinicId)).toBe(2);
    const rows = ledger(w.clinicId);
    expect(rows.map((r) => [r.kind, r.subject_id]).sort()).toEqual(
      [
        ["reminder_2h", soon.id],
        ["reminder_day", day.id],
      ].sort(),
    );
    expect(rows.every((r) => r.requested_by === null)).toBe(true);
    expect(new Date(rows.find((r) => r.subject_id === day.id)!.subject_at)).toEqual(day.startsAt);
    expect(
      events(w.clinicId)
        .map((e) => e.payload.notificationId)
        .sort(),
    ).toEqual(rows.map((r) => r.id).sort());

    // A second scan writes nothing: no new row, no new event.
    expect(await run(w.clinicId)).toBe(0);
    expect(ledger(w.clinicId)).toHaveLength(2);
    expect(events(w.clinicId)).toHaveLength(2);
  });

  it("skips a booking made inside the window, a past start, and anything not booked", async () => {
    const w = withAppointments();
    // Booked 20 h before its start (no day reminder), and 1.5 h before its start (no 2 h reminder).
    seedAppointment(w, { startsAt: inHours(10), createdAt: inHours(-10) });
    seedAppointment(w, { startsAt: inHours(1), createdAt: inHours(-0.5) });
    seedAppointment(w, { startsAt: inHours(-1), createdAt: inHours(-72) });
    seedAppointment(w, { startsAt: inHours(30), createdAt: inHours(-72) });
    seedAppointment(w, { startsAt: inHours(10), createdAt: inHours(-72), status: "cancelled" });
    expect(await run(w.clinicId)).toBe(0);
    expect(ledger(w.clinicId)).toHaveLength(0);
  });

  it("a rescheduled appointment gets fresh reminders for its new start", async () => {
    const w = withAppointments();
    const appt = seedAppointment(w, { startsAt: inHours(10), createdAt: inHours(-72) });
    expect(await run(w.clinicId)).toBe(1);
    owner(`UPDATE appointments SET starts_at = starts_at + interval '3 hours',
             ends_at = ends_at + interval '3 hours' WHERE id = ${q(appt.id)}`);
    expect(await run(w.clinicId)).toBe(1);
    const starts = ledger(w.clinicId).map((r) => new Date(r.subject_at).getTime());
    expect(starts.sort()).toEqual([appt.startsAt.getTime(), appt.startsAt.getTime() + 3 * HOUR]);
  });

  it("queues nothing when the module is off or the clinic switched the reminder off", async () => {
    const off = seedWorld();
    seedAppointment(off, { startsAt: inHours(10), createdAt: inHours(-72) });
    expect(await run(off.clinicId)).toBe(0);

    const quiet = withAppointments();
    setSettings(quiet.clinicId, { reminder_day: false });
    seedAppointment(quiet, { startsAt: inHours(10), createdAt: inHours(-72) });
    const soon = seedAppointment(quiet, { startsAt: inHours(1), createdAt: inHours(-72) });
    expect(await run(quiet.clinicId)).toBe(1);
    expect(ledger(quiet.clinicId).map((r) => [r.kind, r.subject_id])).toEqual([
      ["reminder_2h", soon.id],
    ]);
  });

  it("one clinic's scan never touches another clinic's appointments (RLS)", async () => {
    const a = withAppointments();
    const b = withAppointments();
    seedAppointment(b, { startsAt: inHours(10), createdAt: inHours(-72) });
    expect(await run(a.clinicId)).toBe(0);
    expect(ledger(b.clinicId)).toHaveLength(0);
  });

  it("the scanner walks active clinics on the platform pool and skips a suspended one", async () => {
    const active = withAppointments();
    const suspended = withAppointments();
    owner(`UPDATE clinics SET status = 'suspended' WHERE id = ${q(suspended.clinicId)}`);
    seedAppointment(active, { startsAt: inHours(10), createdAt: inHours(-72) });
    seedAppointment(suspended, { startsAt: inHours(10), createdAt: inHours(-72) });
    const scanner = new AppointmentReminderScanner({
      finder: new PgReminderClinicFinder(platform, 2),
      queue: queue(),
      clock: { now: () => NOW },
      logger: captureLogs().logger,
      intervalMs: 60_000,
    });
    const result = await scanner.runOnce();
    expect(result.failed).toBe(0);
    expect(result.queued).toBeGreaterThanOrEqual(1);
    expect(ledger(active.clinicId)).toHaveLength(1);
    expect(ledger(suspended.clinicId)).toHaveLength(0);
    // Idempotent across whole runs too.
    await scanner.runOnce();
    expect(ledger(active.clinicId)).toHaveLength(1);
  });
});
