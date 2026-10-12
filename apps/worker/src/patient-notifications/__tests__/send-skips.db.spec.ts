import { randomUUID } from "node:crypto";

import { createDatabase, createDispatcherOutbox } from "@eyadex/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  drain,
  eventRow,
  owner,
  ownerJson,
  parkLeftovers,
  urls,
} from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import {
  booked,
  ledgerRow,
  q,
  queueNotification,
  seedAppointment,
  seedSignedVisit,
  seedWorld,
  sendHarness,
  setSettings,
} from "./notification-fixtures.ts";

// Spec §3.3 on real PostgreSQL: each send-time skip reason, and the prescription with its audit row.
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

describe("patient.notification_requested — skip reasons", () => {
  const expectSkipped = (h: ReturnType<typeof make>, id: string, reason: string) => {
    expect(h.platform.sent).toHaveLength(0);
    expect(ledgerRow(id)).toMatchObject({ status: "skipped", skip_reason: reason, route: null });
  };

  it("setting_off: the message switched off since it was queued", async () => {
    const h = make();
    const { w, notificationId } = booked();
    setSettings(w.clinicId, { booked: false });
    await drain(h.poller);
    expectSkipped(h, notificationId, "setting_off");
  });

  it("setting_off: email switched off", async () => {
    const h = make();
    const { w, notificationId } = booked();
    setSettings(w.clinicId, { email_enabled: false });
    await drain(h.poller);
    expectSkipped(h, notificationId, "setting_off");
  });

  it("no_email", async () => {
    const h = make();
    const { w, notificationId } = booked();
    owner(`UPDATE patients SET email = NULL WHERE id = ${q(w.patientId)}`);
    await drain(h.poller);
    expectSkipped(h, notificationId, "no_email");
  });

  it("opted_out stops a reminder, not a confirmation", async () => {
    const h = make();
    const w = seedWorld();
    owner(`UPDATE patients SET notifications_opt_out = true WHERE id = ${q(w.patientId)}`);
    const appt = seedAppointment(w);
    const reminder = queueNotification(w, "reminder_day", appt);
    const confirmation = queueNotification(w, "booked", appt);
    await drain(h.poller);
    expect(ledgerRow(reminder.notificationId)).toMatchObject({ skip_reason: "opted_out" });
    expect(ledgerRow(confirmation.notificationId).status).toBe("sent");
  });

  it("not_booked: the appointment arrived since", async () => {
    const h = make();
    const { appt, notificationId } = booked();
    owner(`UPDATE appointments SET status = 'arrived' WHERE id = ${q(appt.id)}`);
    await drain(h.poller);
    expectSkipped(h, notificationId, "not_booked");
  });

  it("moved: the start is no longer the one the message was built for", async () => {
    const h = make();
    const { appt, notificationId } = booked();
    owner(
      `UPDATE appointments SET starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour'
       WHERE id = ${q(appt.id)}`,
    );
    await drain(h.poller);
    expectSkipped(h, notificationId, "moved");
  });
});

describe("patient.notification_requested — prescription", () => {
  const LINES = [
    {
      medicine: "Amoxicillin 500 mg",
      dose: "1 capsule",
      frequency: "3x daily",
      duration: "7 days",
      note: "after food",
    },
  ];

  it("opens the lines, sends them with the doctor's name, and audits the send without medicine names", async () => {
    const h = make();
    const w = seedWorld();
    const visitId = seedSignedVisit(w, LINES);
    const { notificationId } = queueNotification(w, "prescription", { id: visitId });
    await drain(h.poller);
    const message = h.platform.sent[0]!;
    expect(message.text).toContain(
      "Amoxicillin 500 mg — 1 capsule — 3x daily — 7 days — after food",
    );
    expect(message.text).toContain("Dr. Huda");
    expect(ledgerRow(notificationId)).toMatchObject({ status: "sent", route: "platform" });
    const audit = ownerJson<
      {
        actor_user_id: string;
        category: string;
        entity_type: string;
        entity_id: string;
        branch_id: string;
        details: unknown;
      }[]
    >(
      `SELECT actor_user_id, category, entity_type, entity_id, branch_id, details FROM audit_log
       WHERE clinic_id = ${q(w.clinicId)} AND action = 'patient.prescription_sent'`,
    );
    expect(audit).toEqual([
      {
        actor_user_id: w.staffUserId,
        category: "patient_access",
        entity_type: "patient",
        entity_id: w.patientId,
        branch_id: w.branchId,
        details: { visitId },
      },
    ]);
  });

  it("without a medical key the prescription fails at once; nothing is sent or audited", async () => {
    const h = make(false);
    const w = seedWorld();
    const visitId = seedSignedVisit(w, LINES);
    const { notificationId, eventId } = queueNotification(w, "prescription", { id: visitId });
    await drain(h.poller);
    expect(h.platform.sent).toHaveLength(0);
    expect(ledgerRow(notificationId)).toMatchObject({
      status: "failed",
      last_error: "no_medical_key",
    });
    expect(eventRow(eventId).failed_at).not.toBeNull();
    expect(
      owner(
        `SELECT count(*) FROM audit_log WHERE clinic_id = ${q(w.clinicId)} AND action = 'patient.prescription_sent'`,
      ),
    ).toBe("0");
  });
});
