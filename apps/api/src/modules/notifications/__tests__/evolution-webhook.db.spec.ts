import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";
import {
  addPatient,
  bookingClinic,
  type BookingClinic,
} from "../../appointments/__tests__/appointment-fixtures.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { notificationsOf } from "../persistence/pg-patient-notifications.ts";
import { FakeEvolution } from "./whatsapp-fake-evolution.ts";

let h: Harness;
let C: BookingClinic;
const secret = randomBytes(32).toString("hex");
const evolution = new FakeEvolution();
beforeAll(async () => {
  h = await openHarness({ EVOLUTION_WEBHOOK_SECRET: secret }, true, { evolutionApi: evolution });
  C = await bookingClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
});
afterAll(async () => {
  await closeHarness(h);
  delete process.env["EVOLUTION_WEBHOOK_SECRET"];
});
const hook = (body: unknown, header: string | null = secret) =>
  h.app.inject({
    method: "POST",
    url: "/v1/hooks/evolution",
    // No browser origin, session or CSRF token. This is the internal Docker host.
    headers: {
      host: "eyadex-api:3000",
      ...(header === null ? {} : { "x-eyadex-webhook": header }),
    },
    payload: body as object,
  });
const envelope = (event: string, data: unknown, clinicId = C.clinicId) => ({
  event,
  instance: `eyadex-${clinicId}`,
  data,
});
const sentRow = async (
  status = "sent",
  route = "evolution",
  channel = "whatsapp",
  messageId = "evo.fake",
) => {
  const patientId = await addPatient(h, C.clinicId, C.branchD);
  const id = randomUUID();
  const subjectId = randomUUID();
  await h.owner`INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel,
    subject_type, subject_id, subject_at, status, route, sent_at, provider_message_id, created_at, updated_at)
    VALUES (${C.clinicId}, ${id}, ${patientId}, 'booked', ${channel}, 'appointment', ${subjectId}, now(),
      ${status}, ${status === "sent" ? route : null}, ${status === "sent" ? new Date().toISOString() : null}::timestamptz,
      ${messageId}, now(), now())`;
  return { id, subjectId };
};
const row = async (id: string) =>
  (
    await h.owner`SELECT status, route, sent_at, last_error, provider_message_id FROM patient_notifications WHERE id = ${id}`
  )[0]!;

describe("Evolution webhook over HTTP and real RLS", () => {
  it("refuses missing and wrong headers before any work; unavailable is 404", async () => {
    for (const header of [null, randomBytes(32).toString("hex")]) {
      const res = await hook(envelope("UNKNOWN", {}), header);
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("unauthorized");
    }
    evolution.configured = false;
    try {
      expect((await hook(envelope("UNKNOWN", {}))).statusCode).toBe(404);
    } finally {
      evolution.configured = true;
    }
  });
  it("ignores unknown events, unknown clinics and invalid instance UUIDs with 200", async () => {
    for (const body of [
      envelope("UNKNOWN", {}),
      envelope("CONNECTION_UPDATE", { state: "close" }, randomUUID()),
      {
        event: "MESSAGES_UPDATE",
        instance: "eyadex-invalid",
        data: { status: "ERROR", keyId: "evo.fake" },
      },
    ])
      expect((await hook(body)).statusCode).toBe(200);
  });

  it("the internal host exemption does not reach browser endpoints", async () => {
    expect(
      (
        await h.app.inject({
          method: "GET",
          url: "/v1/clinic/whatsapp",
          headers: { host: "eyadex-api:3000" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/invitations/inspect",
          headers: { host: "eyadex-api:3000" },
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  });
  it.each(["ERROR", 0])(
    "rejects a sent message with status %s, preserving acceptance metadata and history reason",
    async (status) => {
      const messageId = `evo.${randomUUID()}`;
      const { id, subjectId } = await sentRow("sent", "evolution", "whatsapp", messageId);
      const before = await row(id);
      const data = status === 0 ? { status, key: { id: messageId } } : { status, keyId: messageId };
      expect((await hook(envelope("MESSAGES_UPDATE", data))).statusCode).toBe(200);
      expect(await row(id)).toMatchObject({
        ...before,
        status: "failed",
        last_error: "evolution:evo_delivery_rejected",
      });
      expect((await hook(envelope("MESSAGES_UPDATE", data))).statusCode).toBe(200);
      const db = createDatabase({
        url: process.env["EYADEX_TEST_APP_URL"]!,
        role: "eyadex_app",
        ids: systemUuidV7(),
      });
      try {
        const history = await db.withTenant(C.clinicId, (tx) =>
          notificationsOf(tx, C.clinicId, "appointment", subjectId),
        );
        expect(history[0]).toMatchObject({
          status: "failed",
          route: "evolution",
          failureReason: "delivery_rejected",
        });
      } finally {
        await db.close();
      }
    },
  );
  it("does not change another tenant, another route, email or an unsent row", async () => {
    const messageId = `evo.${randomUUID()}`;
    const rows = await Promise.all([
      sentRow("sent", "coexistence", "whatsapp", messageId),
      sentRow("sent", "evolution", "email", messageId),
      sentRow("queued", "evolution", "whatsapp", messageId),
      sentRow("sent", "evolution", "whatsapp", messageId),
    ]);
    const before = await Promise.all(rows.map(({ id }) => row(id)));
    await hook(envelope("MESSAGES_UPDATE", { status: "ERROR", keyId: messageId }, randomUUID()));
    expect(await Promise.all(rows.map(({ id }) => row(id)))).toEqual(before);
    await hook(envelope("MESSAGES_UPDATE", { status: "ERROR", keyId: messageId }));
    expect(await Promise.all(rows.slice(0, 3).map(({ id }) => row(id)))).toEqual(
      before.slice(0, 3),
    );
  });
  it("close disconnects only Evolution and audits once in the linking admin's name", async () => {
    const id = randomUUID();
    const linkedBy = randomUUID();
    await h.owner`INSERT INTO clinic_whatsapp_channels (clinic_id, id, transport, status, instance_name, connected_at,
        risk_accepted_at, risk_accepted_by, risk_version, created_at, updated_at)
      VALUES (${C.clinicId}, ${id}, 'evolution', 'connected', ${`eyadex-${C.clinicId}`}, now(), now(), ${linkedBy}, 1, now(), now())`;
    for (let i = 0; i < 2; i++)
      expect((await hook(envelope("CONNECTION_UPDATE", { state: "close" }))).statusCode).toBe(200);
    expect(
      (
        await h.owner`SELECT status, last_error, connected_at FROM clinic_whatsapp_channels WHERE id = ${id}`
      )[0],
    ).toMatchObject({
      status: "disconnected",
      last_error: "evo_connection_closed",
      connected_at: null,
    });
    const audit =
      await h.owner`SELECT actor_user_id, details FROM audit_log WHERE clinic_id = ${C.clinicId} AND action = 'clinic.whatsapp_disconnected'`;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_user_id: linkedBy,
      details: { transport: "evolution", reason: "connection_closed" },
    });
    await h.owner`UPDATE clinic_whatsapp_channels SET transport = 'coexistence', status = 'connected', connected_at = now(), last_error = NULL WHERE id = ${id}`;
    await hook(envelope("CONNECTION_UPDATE", { state: "close" }));
    expect(
      (await h.owner`SELECT status FROM clinic_whatsapp_channels WHERE id = ${id}`)[0]!["status"],
    ).toBe("connected");
  });
  it("never logs a webhook body", async () => {
    const marker = randomBytes(24).toString("hex");
    await hook(envelope("UNKNOWN", { message: marker }));
    expect(h.logs.join("\n")).not.toContain(marker);
  });
});
