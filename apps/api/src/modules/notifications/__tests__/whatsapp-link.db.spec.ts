import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_NOTIFICATION_SETTINGS } from "@eyadex/contracts/notifications";
import {
  WHATSAPP_RISK_VERSION,
  whatsappChannelViewSchema,
  whatsappQrResponseSchema,
} from "@eyadex/contracts/whatsapp";

import {
  APP,
  call,
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";
import { FAKE_QR, FakeEvolution } from "./whatsapp-fake-evolution.ts";

// Phase 3 N2 (spec §7.1): linking the clinic's number through Evolution by QR, over HTTP, with the
// Evolution boundary faked in memory.
let h: Harness;
const evolution = new FakeEvolution();
const ACCEPT = { acceptRisk: true, riskVersion: WHATSAPP_RISK_VERSION };

type Method = "GET" | "POST" | "PUT";
const send = (method: Method, url: string, cookie?: string, body?: unknown, host = APP) =>
  call(h, {
    method,
    url,
    host,
    ...(cookie === undefined ? {} : { cookie }),
    ...(body === undefined ? {} : { body }),
  });
const connect = (cookie: string, body: unknown = ACCEPT) =>
  send("POST", "/v1/clinic/whatsapp/connect", cookie, body);
const qr = (cookie: string) => send("GET", "/v1/clinic/whatsapp/qr", cookie);
const view = (cookie: string) => send("GET", "/v1/clinic/whatsapp", cookie);
const disconnect = (cookie: string) => send("POST", "/v1/clinic/whatsapp/disconnect", cookie, {});
const saveSettings = (cookie: string, whatsappEnabled: boolean) =>
  send("PUT", "/v1/clinic/notification-settings", cookie, {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    whatsappEnabled,
  });

const instanceOf = (clinicId: string) => `eyadex-${clinicId}`;
const channelRow = async (clinicId: string) =>
  (
    await h.owner`SELECT transport, status, instance_name, phone_last4, risk_accepted_at,
                         risk_accepted_by, risk_version, connected_at
                  FROM clinic_whatsapp_channels WHERE clinic_id = ${clinicId}`
  )[0];
const auditOf = (clinicId: string, action: string) =>
  h.owner`SELECT actor_user_id, entity_type, entity_id, details FROM audit_log
          WHERE clinic_id = ${clinicId} AND action = ${action} ORDER BY created_at, id`;

/** A clinic whose number is linked: connected, then scanned, then refreshed. */
async function linkedClinic() {
  const A = await clinicWithMembers(h);
  expect((await connect(A.admin.cookie)).statusCode).toBe(200);
  evolution.scan(instanceOf(A.admin.clinicId));
  expect((await qr(A.admin.cookie)).json()).toEqual({ status: "connected", qrDataUrl: null });
  return A;
}

beforeAll(async () => {
  h = await openHarness({}, true, { evolutionApi: evolution });
});
afterAll(async () => {
  await closeHarness(h);
});

describe("RBAC-01: the WhatsApp routes", () => {
  const routes: [Method, string, unknown][] = [
    ["GET", "/v1/clinic/whatsapp", undefined],
    ["POST", "/v1/clinic/whatsapp/connect", ACCEPT],
    ["GET", "/v1/clinic/whatsapp/qr", undefined],
    ["POST", "/v1/clinic/whatsapp/disconnect", {}],
    ["PUT", "/v1/clinic/whatsapp/coexistence", {}],
  ];
  it.each(routes)("%s %s: no session 401, doctor 403, platform host 404", async (m, url, body) => {
    const A = await clinicWithMembers(h);
    expect((await send(m, url, undefined, body)).statusCode).toBe(401);
    expect((await send(m, url, A.doctor.cookie, body)).statusCode).toBe(403);
    expect((await send(m, url, A.admin.cookie, body, PLATFORM)).statusCode).toBe(404);
    expect(await channelRow(A.admin.clinicId)).toBeUndefined();
  });
});

describe("linking by QR (Evolution)", () => {
  it("a clinic that never linked reads an unlinked channel", async () => {
    const A = await clinicWithMembers(h);
    const res = await view(A.admin.cookie);
    expect(res.statusCode).toBe(200);
    expect(whatsappChannelViewSchema.parse(res.json())).toMatchObject({
      transport: null,
      status: "disconnected",
      phoneLast4: null,
      riskAcceptedAt: null,
      hasCredentials: false,
    });
  });

  it("connect records the risk once, creates the instance once and answers the QR", async () => {
    const A = await clinicWithMembers(h);
    const clinicId = A.admin.clinicId;
    const first = await connect(A.admin.cookie);
    expect(first.statusCode).toBe(200);
    expect(whatsappQrResponseSchema.parse(first.json())).toEqual({
      status: "pending",
      qrDataUrl: FAKE_QR,
    });
    expect((await connect(A.admin.cookie)).json()).toEqual({
      status: "pending",
      qrDataUrl: FAKE_QR,
    });
    expect(evolution.createdCount(instanceOf(clinicId))).toBe(1);
    expect(evolution.created.find((c) => c.name === instanceOf(clinicId))?.integration).toEqual({
      kind: "baileys",
    });
    expect(await channelRow(clinicId)).toMatchObject({
      transport: "evolution",
      status: "pending",
      instance_name: instanceOf(clinicId),
      risk_accepted_by: A.admin.userId,
      risk_version: WHATSAPP_RISK_VERSION,
      connected_at: null,
    });
    const risk = await auditOf(clinicId, "clinic.whatsapp_risk_accepted");
    expect(risk).toHaveLength(1);
    expect(risk[0]).toMatchObject({
      actor_user_id: A.admin.userId,
      entity_type: "clinic",
      entity_id: clinicId,
      details: { riskVersion: WHATSAPP_RISK_VERSION },
    });
  });

  it("refuses a connect without the current risk acceptance and records nothing", async () => {
    const A = await clinicWithMembers(h);
    for (const body of [{}, { acceptRisk: false, riskVersion: 1 }, { acceptRisk: true }]) {
      expect((await connect(A.admin.cookie, body)).statusCode).toBe(400);
    }
    expect(await channelRow(A.admin.clinicId)).toBeUndefined();
  });

  it("the QR refresh turns pending into connected with the last four digits, audited once", async () => {
    const A = await clinicWithMembers(h);
    const clinicId = A.admin.clinicId;
    await connect(A.admin.cookie);
    expect((await qr(A.admin.cookie)).json()).toEqual({ status: "pending", qrDataUrl: FAKE_QR });
    evolution.scan(instanceOf(clinicId));
    expect((await qr(A.admin.cookie)).json()).toEqual({ status: "connected", qrDataUrl: null });
    expect((await qr(A.admin.cookie)).json()).toEqual({ status: "connected", qrDataUrl: null });
    const channel = whatsappChannelViewSchema.parse((await view(A.admin.cookie)).json());
    expect(channel).toMatchObject({
      transport: "evolution",
      status: "connected",
      phoneLast4: "4321",
    });
    expect(channel.connectedAt).not.toBeNull();
    expect(await auditOf(clinicId, "clinic.whatsapp_connected")).toHaveLength(1);
    // Linked already: connect answers connected without asking Evolution for a new instance.
    expect((await connect(A.admin.cookie)).json()).toEqual({
      status: "connected",
      qrDataUrl: null,
    });
    expect(evolution.createdCount(instanceOf(clinicId))).toBe(1);
  });

  it("disconnect logs the number out, clears the link and audits once", async () => {
    const A = await linkedClinic();
    const clinicId = A.admin.clinicId;
    const res = await disconnect(A.admin.cookie);
    expect(res.statusCode).toBe(200);
    expect(whatsappChannelViewSchema.parse(res.json())).toMatchObject({
      status: "disconnected",
      phoneLast4: null,
      connectedAt: null,
    });
    expect(evolution.instances.get(instanceOf(clinicId))?.state).toBe("close");
    expect((await disconnect(A.admin.cookie)).statusCode).toBe(200);
    const audit = await auditOf(clinicId, "clinic.whatsapp_disconnected");
    expect(audit).toHaveLength(1);
    expect(audit[0]!["details"]).toEqual({ transport: "evolution" });
    // Linking again reuses the instance and does not ask for the risk again.
    expect((await connect(A.admin.cookie)).json()).toEqual({
      status: "pending",
      qrDataUrl: FAKE_QR,
    });
    expect(evolution.createdCount(instanceOf(clinicId))).toBe(1);
    expect(await auditOf(clinicId, "clinic.whatsapp_risk_accepted")).toHaveLength(1);
  });

  it("without Evolution configured, connect answers 503 and records nothing", async () => {
    const A = await clinicWithMembers(h);
    evolution.configured = false;
    try {
      const res = await connect(A.admin.cookie);
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ code: "unknown", details: { code: "unavailable" } });
    } finally {
      evolution.configured = true;
    }
    expect(await channelRow(A.admin.clinicId)).toBeUndefined();
  });
});

describe("the WhatsApp switch in the notification settings", () => {
  it("is refused while the channel is not connected, and accepted once it is", async () => {
    const A = await clinicWithMembers(h);
    const refused = await saveSettings(A.admin.cookie, true);
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({
      code: "validation",
      details: [{ path: ["whatsappEnabled"], code: "whatsapp_not_connected" }],
    });
    await connect(A.admin.cookie);
    expect((await saveSettings(A.admin.cookie, true)).statusCode).toBe(400);
    evolution.scan(instanceOf(A.admin.clinicId));
    await qr(A.admin.cookie);
    expect((await saveSettings(A.admin.cookie, true)).statusCode).toBe(200);
    const saved = await send("GET", "/v1/clinic/notification-settings", A.admin.cookie);
    expect(saved.json()).toMatchObject({ whatsappEnabled: true });
  });
});

describe("cross-clinic isolation", () => {
  it("another clinic's link is neither seen nor counted", async () => {
    await linkedClinic();
    const B = await clinicWithMembers(h);
    expect((await view(B.admin.cookie)).json()).toMatchObject({ status: "disconnected" });
    expect((await qr(B.admin.cookie)).json()).toEqual({ status: "disconnected", qrDataUrl: null });
    expect((await saveSettings(B.admin.cookie, true)).statusCode).toBe(400);
    expect((await disconnect(B.admin.cookie)).json()).toMatchObject({ status: "disconnected" });
    expect(await channelRow(B.admin.clinicId)).toBeUndefined();
  });
});

describe("never logged", () => {
  it("no log line carries the QR", () => {
    expect(h.logs.join("\n")).not.toContain(FAKE_QR.slice(22, 60));
  });
});
