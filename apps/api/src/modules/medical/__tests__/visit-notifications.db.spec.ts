import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_NOTIFICATION_SETTINGS,
  patientNotificationListSchema,
} from "@eyadex/contracts/notifications";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { medicalClinic, patientIn, startedVisit, type MedicalClinic } from "./medical-fixtures.ts";

// Phase 3 N1 (N-5, spec §3.4, ADR-0031): signing a visit with prescription lines queues one prescription
// email and one id-only event in the signing transaction; the visit's history answers it under the
// visit's view rules.
let h: Harness;
let C: MedicalClinic;
let otherReaderCookie: string;

const NOTE = { complaint: "headache", examination: null, assessment: null, plan: null };
const LINE = {
  medicine: "Paracetamol 500 mg",
  dose: "1 tablet",
  frequency: "every 8 hours",
  duration: "3 days",
  note: null,
};

async function draft(lines: unknown[]): Promise<{ id: string; patient: string }> {
  const patient = await patientIn(h, C, C.branchD);
  const id = await startedVisit(h, C.doctor.cookie, { patientId: patient, branchId: C.branchD });
  expect((await send(h, C.doctor.cookie, "PUT", `/v1/visits/${id}/note`, NOTE)).statusCode).toBe(
    200,
  );
  if (lines.length > 0) {
    const saved = await send(h, C.doctor.cookie, "PUT", `/v1/visits/${id}/prescription`, {
      items: lines,
    });
    expect(saved.statusCode).toBe(200);
  }
  return { id, patient };
}

const sign = (id: string) => send(h, C.doctor.cookie, "POST", `/v1/visits/${id}/sign`, {});
const ledger = (visitId: string) =>
  h.owner`SELECT id, kind, channel, status, subject_type, subject_at, requested_by, patient_id
          FROM patient_notifications WHERE subject_id = ${visitId} ORDER BY created_at, id`;
const history = (cookie: string, id: string) =>
  send(h, cookie, "GET", `/v1/visits/${id}/notifications`);

beforeAll(async () => {
  h = await openHarness({}, true);
  const invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await medicalClinic(h, invalidate);
  otherReaderCookie = (await medicalClinic(h, invalidate)).reader.cookie;
});
afterAll(() => closeHarness(h));

describe("queueing on sign (N-5)", () => {
  it("a visit signed with prescription lines queues one prescription email and one id-only event", async () => {
    const { id, patient } = await draft([LINE]);
    expect((await sign(id)).statusCode).toBe(200);
    const rows = await ledger(id);
    expect(rows).toEqual([
      {
        id: rows[0]!["id"],
        kind: "prescription",
        channel: "email",
        status: "queued",
        subject_type: "visit",
        subject_at: null,
        requested_by: C.doctor.memberId,
        patient_id: patient,
      },
    ]);
    const events = await h.owner`SELECT payload FROM outbox_events
      WHERE clinic_id = ${C.clinicId} AND event_type = 'patient.notification_requested'
        AND payload->>'notificationId' = ${rows[0]!["id"] as string}`;
    expect(events.map((e) => e["payload"])).toEqual([{ notificationId: rows[0]!["id"] }]);
    // An addendum after the sign never sends it again.
    const addendum = await send(h, C.doctor.cookie, "POST", `/v1/visits/${id}/addenda`, {
      body: "follow-up in a week",
    });
    expect(addendum.statusCode).toBe(201);
    expect(await ledger(id)).toHaveLength(1);
  });

  it("a visit signed without prescription lines queues nothing", async () => {
    const { id } = await draft([]);
    expect((await sign(id)).statusCode).toBe(200);
    expect(await ledger(id)).toHaveLength(0);
  });

  it("the prescription message switched off queues nothing", async () => {
    const messages = { ...DEFAULT_NOTIFICATION_SETTINGS.messages, prescription: false };
    const off = await send(h, C.admin.cookie, "PUT", "/v1/clinic/notification-settings", {
      emailEnabled: true,
      messages,
    });
    expect(off.statusCode).toBe(200);
    const { id } = await draft([LINE]);
    expect((await sign(id)).statusCode).toBe(200);
    expect(await ledger(id)).toHaveLength(0);
    const on = await send(
      h,
      C.admin.cookie,
      "PUT",
      "/v1/clinic/notification-settings",
      DEFAULT_NOTIFICATION_SETTINGS,
    );
    expect(on.statusCode).toBe(200);
  });
});

describe("GET /v1/visits/:id/notifications", () => {
  it("answers the visit's history to the doctor and to a visits reader", async () => {
    const { id } = await draft([LINE]);
    await sign(id);
    for (const cookie of [C.doctor.cookie, C.reader.cookie]) {
      const res = await history(cookie, id);
      expect(res.statusCode).toBe(200);
      const list = patientNotificationListSchema.parse(res.json());
      expect(list.items.map((i) => [i.kind, i.status])).toEqual([["prescription", "queued"]]);
    }
  });

  it("is not_found outside the visits reach, in another clinic and for a malformed id", async () => {
    const { id } = await draft([LINE]);
    await sign(id);
    // The front desk reads visits of branch R only; this visit is on branch D.
    expect((await history(C.front.cookie, id)).statusCode).toBe(404);
    expect((await history(otherReaderCookie, id)).statusCode).toBe(404);
    expect((await history(C.doctor.cookie, "not-an-id")).statusCode).toBe(404);
  });
});
