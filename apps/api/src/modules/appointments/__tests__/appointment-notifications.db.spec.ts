import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_NOTIFICATION_SETTINGS,
  patientNotificationListSchema,
  type NotificationSettings,
} from "@eyadex/contracts/notifications";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import {
  addPatient,
  at,
  book,
  bookingBody,
  bookingClinic,
  type BookingClinic,
} from "./appointment-fixtures.ts";
import { send } from "./scheduling-fixtures.ts";

// Phase 3 N1 (spec §3.1, ADR-0031): booking, rescheduling and cancelling queue one ledger row and one
// id-only outbox event per enabled message, in the same transaction; the history answers it newest first
// under the appointment's view rules.
let h: Harness;
let C: BookingClinic;
let other: BookingClinic;
const DAY = "2027-04-04"; // a Sunday
let minute = 0;

const nextTime = () => {
  minute += 30;
  return `${String(8 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
};

async function booked(clinic = C): Promise<{ id: string; startsAt: string; patient: string }> {
  const patient = await addPatient(h, clinic.clinicId, clinic.branchD);
  const startsAt = at(DAY, nextTime());
  const res = await book(h, clinic.admin.cookie, bookingBody(clinic, patient, startsAt));
  if (res.statusCode !== 201) throw new Error(`book ${res.statusCode} ${res.body}`);
  return { id: res.json().appointment.id as string, startsAt, patient };
}

const ledger = (subjectId: string) =>
  h.owner`SELECT id, kind, channel, status, subject_type, subject_at, requested_by, patient_id,
            skip_reason, route, sent_at
          FROM patient_notifications WHERE subject_id = ${subjectId} ORDER BY created_at, id`;
const events = (clinicId: string, ids: readonly unknown[]) =>
  h.owner`SELECT payload FROM outbox_events
          WHERE clinic_id = ${clinicId} AND event_type = 'patient.notification_requested'
            AND payload->>'notificationId' IN ${h.owner(ids.map(String))}`;
const settings = (clinic: BookingClinic, body: NotificationSettings) =>
  send(h, clinic.admin.cookie, "PUT", "/v1/clinic/notification-settings", body);
const history = (cookie: string, id: string) =>
  send(h, cookie, "GET", `/v1/appointments/${id}/notifications`);
const move = (id: string, startsAt: string) =>
  send(h, C.admin.cookie, "PUT", `/v1/appointments/${id}`, {
    branchId: C.branchD,
    providerMembershipId: C.doctor.memberId,
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 20 * 60_000).toISOString(),
    overbook: false,
  });
const cancel = (id: string) =>
  send(h, C.admin.cookie, "POST", `/v1/appointments/${id}/cancel`, {
    reason: "patient_cancelled",
    note: null,
  });
const iso = (value: unknown) => new Date(value as string).toISOString();

beforeAll(async () => {
  h = await openHarness({}, true);
  const invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await bookingClinic(h, invalidate);
  other = await bookingClinic(h, invalidate);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("queueing on appointment changes", () => {
  it("a booking queues one booked email with the start and the actor's membership, and one id-only event", async () => {
    const { id, startsAt, patient } = await booked();
    const rows = await ledger(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "booked",
      channel: "email",
      status: "queued",
      subject_type: "appointment",
      requested_by: C.admin.memberId,
      patient_id: patient,
      skip_reason: null,
      route: null,
      sent_at: null,
    });
    expect(iso(rows[0]!["subject_at"])).toBe(new Date(startsAt).toISOString());
    const sent = await events(C.clinicId, [rows[0]!["id"]]);
    expect(sent.map((e) => e["payload"])).toEqual([{ notificationId: rows[0]!["id"] }]);
  });

  it("a replayed booking queues nothing more", async () => {
    const patient = await addPatient(h, C.clinicId, C.branchD);
    const body = bookingBody(C, patient, at(DAY, nextTime()));
    const key = randomUUID();
    const first = await book(h, C.admin.cookie, body, key);
    expect((await book(h, C.admin.cookie, body, key)).statusCode).toBe(201);
    expect(await ledger(first.json().appointment.id as string)).toHaveLength(1);
  });

  it("a reschedule queues one rescheduled email for the new start; the same values queue nothing", async () => {
    const { id } = await booked();
    const later = at(DAY, nextTime());
    expect((await move(id, later)).statusCode).toBe(200);
    expect((await move(id, later)).statusCode).toBe(200);
    const rows = await ledger(id);
    expect(rows.map((r) => r["kind"])).toEqual(["booked", "rescheduled"]);
    expect(iso(rows[1]!["subject_at"])).toBe(new Date(later).toISOString());
    expect(
      await events(
        C.clinicId,
        rows.map((r) => r["id"]),
      ),
    ).toHaveLength(2);
  });

  it("a cancellation queues one cancelled email for the start it had; a status change queues none", async () => {
    const { id, startsAt } = await booked();
    const arrived = await send(h, C.admin.cookie, "POST", `/v1/appointments/${id}/status`, {
      status: "arrived",
    });
    expect(arrived.statusCode).toBe(200);
    expect((await cancel(id)).statusCode).toBe(200);
    expect((await cancel(id)).statusCode).toBe(200);
    const rows = await ledger(id);
    expect(rows.map((r) => r["kind"])).toEqual(["booked", "cancelled"]);
    expect(iso(rows[1]!["subject_at"])).toBe(new Date(startsAt).toISOString());
  });

  it("a message switched off, or the email channel off, queues no row and no event", async () => {
    const messages = { ...DEFAULT_NOTIFICATION_SETTINGS.messages, booked: false };
    expect((await settings(C, { emailEnabled: true, messages })).statusCode).toBe(200);
    const { id } = await booked();
    expect(await ledger(id)).toHaveLength(0);
    expect((await move(id, at(DAY, nextTime()))).statusCode).toBe(200);
    expect((await ledger(id)).map((r) => r["kind"])).toEqual(["rescheduled"]);
    const off = { emailEnabled: false, messages: DEFAULT_NOTIFICATION_SETTINGS.messages };
    expect((await settings(C, off)).statusCode).toBe(200);
    expect((await cancel(id)).statusCode).toBe(200);
    const after = await booked();
    expect((await ledger(id)).map((r) => r["kind"])).toEqual(["rescheduled"]);
    expect(await ledger(after.id)).toHaveLength(0);
    expect((await settings(C, DEFAULT_NOTIFICATION_SETTINGS)).statusCode).toBe(200);
  });
});

describe("GET /v1/appointments/:id/notifications", () => {
  it("answers the history newest first, without any address", async () => {
    const { id } = await booked();
    await move(id, at(DAY, nextTime()));
    const res = await history(C.admin.cookie, id);
    expect(res.statusCode).toBe(200);
    const list = patientNotificationListSchema.parse(res.json());
    expect(list.items.map((i) => i.kind)).toEqual(["rescheduled", "booked"]);
    expect(list.items[0]).toMatchObject({ channel: "email", status: "queued", sentAt: null });
  });

  it("is not_found outside the caller's view, in another clinic and for a malformed id", async () => {
    const { id } = await booked();
    // The front desk holds view:appointments:branch on branch R only; the booking is on branch D.
    expect((await history(C.front.cookie, id)).statusCode).toBe(404);
    expect((await history(other.admin.cookie, id)).statusCode).toBe(404);
    expect((await history(C.admin.cookie, "not-an-id")).statusCode).toBe(404);
    expect((await history(C.doctor.cookie, id)).statusCode).toBe(200);
  });
});
