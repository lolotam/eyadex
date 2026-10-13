import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_NOTIFICATION_SETTINGS } from "@eyadex/contracts/notifications";
import {
  WHATSAPP_RISK_VERSION,
  whatsappChannelViewSchema,
  type WhatsappCoexistenceRequest,
} from "@eyadex/contracts/whatsapp";
import { SecretSealer } from "@eyadex/secrets";

import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";
import {
  addPatient,
  at,
  book,
  bookingBody,
  bookingClinic,
  type BookingClinic,
} from "../../appointments/__tests__/appointment-fixtures.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { randomBytes } from "node:crypto";
import { ApiError, ServiceUnavailableError } from "../../../shared/errors.ts";
import { FakeMeta } from "./whatsapp-fake-meta.ts";
import { FakeEvolution } from "./whatsapp-fake-evolution.ts";

// Phase 3 N2 (spec §7.1): the coexistence credentials (write-only, sealed) and queueing on both channels,
// over HTTP with the Evolution boundary faked in memory.
let h: Harness;
let C: BookingClinic;
const evolution = new FakeEvolution();
// Shaped placeholders, never real Meta credentials.
const TOKEN = randomBytes(24).toString("hex");
const TOKEN_2 = randomBytes(24).toString("hex");
const meta = new FakeMeta();
const NONE = Object.fromEntries(
  Object.keys(DEFAULT_NOTIFICATION_SETTINGS.messages).map((kind) => [kind, null]),
) as WhatsappCoexistenceRequest["templates"];
const BODY: WhatsappCoexistenceRequest = {
  accessToken: TOKEN,
  phoneNumberId: "123456789",
  businessAccountId: "987654321",
  templates: { ...NONE, booked: { name: "booking_confirmed", language: "ar" } },
};

const coexistence = (cookie: string, body: unknown) =>
  send(h, cookie, "PUT", "/v1/clinic/whatsapp/coexistence", body);
const sealedRow = async (clinicId: string) =>
  (
    await h.owner`SELECT id, transport, status, sealed_credentials, phone_number_id, templates
                  FROM clinic_whatsapp_channels WHERE clinic_id = ${clinicId}`
  )[0]!;
const opened = (row: Record<string, unknown>) =>
  new SecretSealer(process.env["MAIL_PROVIDER_SEAL_KEY"]!).open(
    row["sealed_credentials"] as string,
    row["id"] as string,
  );
const auditOf = (clinicId: string, action: string) =>
  h.owner`SELECT details FROM audit_log WHERE clinic_id = ${clinicId} AND action = ${action}
          ORDER BY created_at, id`;
const ledger = (subjectId: string) =>
  h.owner`SELECT id, kind, channel, status FROM patient_notifications
          WHERE subject_id = ${subjectId} ORDER BY channel`;
const events = (clinicId: string, ids: readonly unknown[]) =>
  h.owner`SELECT payload FROM outbox_events
          WHERE clinic_id = ${clinicId} AND event_type = 'patient.notification_requested'
            AND payload->>'notificationId' IN ${h.owner(ids.map(String))}`;

beforeAll(async () => {
  h = await openHarness({}, true, { evolutionApi: evolution, metaApi: meta });
  C = await bookingClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
});
afterAll(async () => {
  await closeHarness(h);
});

describe("PUT /v1/clinic/whatsapp/coexistence", () => {
  it("needs the token on the first save", async () => {
    const A = await clinicWithMembers(h);
    const { accessToken: _omitted, ...withoutToken } = BODY;
    const res = await coexistence(A.admin.cookie, withoutToken);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ details: [{ path: ["accessToken"], code: "required" }] });
  });

  it("seals the token to the row, verifies Meta directly and never returns the token", async () => {
    const A = await clinicWithMembers(h);
    const clinicId = A.admin.clinicId;
    const res = await coexistence(A.admin.cookie, BODY);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(TOKEN);
    expect(whatsappChannelViewSchema.parse(res.json())).toMatchObject({
      transport: "coexistence",
      status: "connected",
      hasCredentials: true,
      phoneNumberId: BODY.phoneNumberId,
      businessAccountId: BODY.businessAccountId,
      templates: BODY.templates,
    });
    const view = await send(h, A.admin.cookie, "GET", "/v1/clinic/whatsapp");
    expect(view.statusCode).toBe(200);
    expect(whatsappChannelViewSchema.parse(view.json())).toMatchObject({
      phoneNumberId: BODY.phoneNumberId,
      businessAccountId: BODY.businessAccountId,
    });
    for (const response of [res, view]) {
      expect(response.json()).not.toHaveProperty("accessToken");
      expect(response.json()).not.toHaveProperty("sealedCredentials");
      expect(response.body).not.toContain(TOKEN);
    }
    const row = await sealedRow(clinicId);
    expect(row["sealed_credentials"]).not.toContain(TOKEN);
    expect(opened(row)).toBe(TOKEN);
    expect(meta.calls.at(-1)).toEqual({
      accessToken: TOKEN,
      phoneNumberId: BODY.phoneNumberId,
      businessAccountId: BODY.businessAccountId,
    });
    expect(evolution.createdCount(`eyadex-${clinicId}`)).toBe(0);
    expect(res.json().phoneLast4).toBe("0001");
  });

  it("keeps the stored token when omitted, and verifies only for changed credentials", async () => {
    const A = await clinicWithMembers(h);
    const clinicId = A.admin.clinicId;
    await coexistence(A.admin.cookie, BODY);
    const initial = meta.calls.length;
    const { accessToken: _omitted, ...withoutToken } = BODY;
    const templates = {
      ...BODY.templates,
      cancelled: { name: "booking_cancelled", language: "en" },
    };
    const kept = await coexistence(A.admin.cookie, { ...withoutToken, templates });
    expect(kept.statusCode).toBe(200);
    expect(kept.json()).toMatchObject({ hasCredentials: true, templates });
    expect(opened(await sealedRow(clinicId))).toBe(TOKEN);
    expect(meta.calls.length).toBe(initial);
    // The same body again writes nothing.
    await coexistence(A.admin.cookie, { ...withoutToken, templates });
    expect(await auditOf(clinicId, "clinic.whatsapp_coexistence_updated")).toHaveLength(2);
    await coexistence(A.admin.cookie, { ...withoutToken, templates, accessToken: TOKEN_2 });
    expect(opened(await sealedRow(clinicId))).toBe(TOKEN_2);
    expect(meta.calls.length).toBe(initial + 1);
    const audit = JSON.stringify(await auditOf(clinicId, "clinic.whatsapp_coexistence_updated"));
    expect(audit).not.toContain(TOKEN);
    expect(audit).not.toContain(TOKEN_2);
    expect(audit).not.toContain("123456789");
  });

  it("is refused while an Evolution number is being linked, and replaces it once unlinked", async () => {
    const A = await clinicWithMembers(h);
    const clinicId = A.admin.clinicId;
    const link = { acceptRisk: true, riskVersion: WHATSAPP_RISK_VERSION };
    await send(h, A.admin.cookie, "POST", "/v1/clinic/whatsapp/connect", link);
    const refused = await coexistence(A.admin.cookie, BODY);
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({
      details: [{ path: ["transport"], code: "evolution_linked" }],
    });
    await send(h, A.admin.cookie, "POST", "/v1/clinic/whatsapp/disconnect", {});
    expect((await coexistence(A.admin.cookie, BODY)).statusCode).toBe(200);
    expect(evolution.createdCount(`eyadex-${clinicId}`)).toBe(1);
    expect(evolution.instances.get(`eyadex-${clinicId}`)?.integration.kind).toBe("baileys");
  });

  it("coexistence save and view work with Evolution unavailable", async () => {
    const A = await clinicWithMembers(h);
    evolution.configured = false;
    try {
      expect((await coexistence(A.admin.cookie, BODY)).statusCode).toBe(200);
      expect((await send(h, A.admin.cookie, "GET", "/v1/clinic/whatsapp")).json()).toMatchObject({
        transport: "coexistence",
        status: "connected",
      });
    } finally {
      evolution.configured = true;
    }
  });
  it("invalid or unavailable Meta verification leaves credentials unchanged", async () => {
    const A = await clinicWithMembers(h);
    await coexistence(A.admin.cookie, BODY);
    for (const error of [
      new ApiError("validation", [{ path: ["accessToken"], code: "meta_credentials_invalid" }]),
      new ServiceUnavailableError(),
    ]) {
      meta.error = error;
      try {
        expect(
          (await coexistence(A.admin.cookie, { ...BODY, accessToken: TOKEN_2 })).statusCode,
        ).toBe(error.status);
        expect(opened(await sealedRow(A.admin.clinicId))).toBe(TOKEN);
      } finally {
        meta.error = null;
      }
    }
  });
  it("changing a Meta id verifies again", async () => {
    const A = await clinicWithMembers(h);
    await coexistence(A.admin.cookie, BODY);
    const initial = meta.calls.length;
    expect(
      (await coexistence(A.admin.cookie, { ...BODY, phoneNumberId: "30000" })).statusCode,
    ).toBe(200);
    expect(meta.calls.length).toBe(initial + 1);
  });

  it("no log line carries the token", () => {
    const logs = h.logs.join("\n");
    expect(logs).not.toContain(TOKEN);
    expect(logs).not.toContain(TOKEN_2);
  });
});

describe("queueing on both channels (spec §7.1)", () => {
  let minute = 0;
  const booked = async () => {
    minute += 30;
    const time = `${String(8 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const patient = await addPatient(h, C.clinicId, C.branchD);
    const res = await book(h, C.admin.cookie, bookingBody(C, patient, at("2027-04-04", time)));
    if (res.statusCode !== 201) throw new Error(`book ${res.statusCode} ${res.body}`);
    return res.json().appointment.id as string;
  };
  const settings = (whatsappEnabled: boolean) =>
    send(h, C.admin.cookie, "PUT", "/v1/clinic/notification-settings", {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      whatsappEnabled,
    });

  it("a booking queues an email and a WhatsApp row, each with its id-only event, while linked", async () => {
    expect((await coexistence(C.admin.cookie, BODY)).statusCode).toBe(200);
    expect((await settings(true)).statusCode).toBe(200);
    const id = await booked();
    const rows = await ledger(id);
    expect(rows.map((r) => [r["kind"], r["channel"], r["status"]])).toEqual([
      ["booked", "email", "queued"],
      ["booked", "whatsapp", "queued"],
    ]);
    const sent = await events(
      C.clinicId,
      rows.map((r) => r["id"]),
    );
    expect(sent.map((e) => e["payload"])).toEqual(
      expect.arrayContaining(rows.map((r) => ({ notificationId: r["id"] }))),
    );
    expect(sent).toHaveLength(2);
  });

  it("queues email only once the channel is unlinked, though the switch stays on", async () => {
    const res = await send(h, C.admin.cookie, "POST", "/v1/clinic/whatsapp/disconnect", {});
    expect(res.statusCode).toBe(200);
    const id = await booked();
    expect((await ledger(id)).map((r) => r["channel"])).toEqual(["email"]);
  });
});
