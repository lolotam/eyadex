import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_NOTIFICATION_SETTINGS } from "@eyadex/contracts/notifications";
import {
  WHATSAPP_RISK_VERSION,
  whatsappChannelViewSchema,
  whatsappSignupConfigSchema,
} from "@eyadex/contracts/whatsapp";
import { SecretSealer } from "@eyadex/secrets";

import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";
import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { ApiError, ServiceUnavailableError } from "../../../shared/errors.ts";
import { FakeEvolution } from "./whatsapp-fake-evolution.ts";
import { FakeMeta } from "./whatsapp-fake-meta.ts";

// Spec §7.2 over HTTP and real RLS, with only the Meta and Evolution network boundaries faked.
const META = {
  META_APP_ID: "1234567890",
  META_APP_SECRET: randomBytes(16).toString("hex"),
  META_WHATSAPP_CONFIG_ID: "9876543210",
  META_WEBHOOK_VERIFY_TOKEN: randomBytes(32).toString("hex"),
};
const number = () => `3${BigInt(`0x${randomBytes(8).toString("hex")}`)}`.slice(0, 18);
const meta = new FakeMeta();
const evolution = new FakeEvolution();
let h: Harness;

beforeAll(async () => {
  h = await openHarness(META, true, { evolutionApi: evolution, metaApi: meta });
});
afterAll(async () => {
  await closeHarness(h);
  for (const name of Object.keys(META)) delete process.env[name];
});

const signup = (cookie: string, body: unknown) =>
  send(h, cookie, "POST", "/v1/clinic/whatsapp/embedded-signup", body);
const request = () => ({
  code: randomBytes(16).toString("hex"),
  wabaId: number(),
  phoneNumberId: number(),
});
const channel = async (clinicId: string) =>
  (
    await h.owner`SELECT id, transport, status, sealed_credentials, phone_number_id, business_account_id,
                    templates FROM clinic_whatsapp_channels WHERE clinic_id = ${clinicId}`
  )[0];
const refusal = (path: string, code: string) => ({ details: [{ path: [path], code }] });

describe("GET /v1/clinic/whatsapp/signup-config", () => {
  it("answers the public ids and the Graph version, never the secret", async () => {
    const A = await clinicWithMembers(h);
    const res = await send(h, A.admin.cookie, "GET", "/v1/clinic/whatsapp/signup-config");
    expect(res.statusCode).toBe(200);
    expect(whatsappSignupConfigSchema.parse(res.json())).toEqual({
      appId: META.META_APP_ID,
      configId: META.META_WHATSAPP_CONFIG_ID,
      graphVersion: "v22.0",
    });
    expect(res.body).not.toContain(META.META_APP_SECRET);
    expect(res.body).not.toContain(META.META_WEBHOOK_VERIFY_TOKEN);
  });

  it("needs the clinic settings view key", async () => {
    const A = await clinicWithMembers(h);
    const res = await send(h, A.doctor.cookie, "GET", "/v1/clinic/whatsapp/signup-config");
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/clinic/whatsapp/embedded-signup", () => {
  it("exchanges the code, verifies, seals the token and keeps the templates", async () => {
    const A = await clinicWithMembers(h);
    const clinicId = A.admin.clinicId;
    const templates = Object.fromEntries(
      Object.keys(DEFAULT_NOTIFICATION_SETTINGS.messages).map((kind) => [kind, null]),
    );
    const manual = await send(h, A.admin.cookie, "PUT", "/v1/clinic/whatsapp/coexistence", {
      accessToken: randomBytes(24).toString("hex"),
      phoneNumberId: number(),
      businessAccountId: number(),
      templates: { ...templates, booked: { name: "booking_ok", language: "ar" } },
    });
    expect(manual.statusCode).toBe(200);
    const body = request();
    meta.token = randomBytes(24).toString("hex");
    const res = await signup(A.admin.cookie, body);
    expect(res.statusCode).toBe(200);
    expect(whatsappChannelViewSchema.parse(res.json())).toMatchObject({
      transport: "coexistence",
      status: "connected",
      hasCredentials: true,
      phoneNumberId: body.phoneNumberId,
      businessAccountId: body.wabaId,
      phoneLast4: "0001",
      templates: { booked: { name: "booking_ok", language: "ar" } },
    });
    for (const secret of [meta.token, body.code, META.META_APP_SECRET])
      expect(res.body).not.toContain(secret);
    expect(meta.exchanges.at(-1)).toEqual({
      code: body.code,
      app: { appId: META.META_APP_ID, appSecret: META.META_APP_SECRET },
    });
    expect(meta.calls.at(-1)).toEqual({
      accessToken: meta.token,
      phoneNumberId: body.phoneNumberId,
      businessAccountId: body.wabaId,
    });
    const row = (await channel(clinicId))!;
    expect(row["sealed_credentials"]).not.toContain(meta.token);
    expect(
      new SecretSealer(process.env["MAIL_PROVIDER_SEAL_KEY"]!).open(
        row["sealed_credentials"] as string,
        row["id"] as string,
      ),
    ).toBe(meta.token);
    const audit = await h.owner`SELECT details FROM audit_log WHERE clinic_id = ${clinicId}
      AND action = 'clinic.whatsapp_coexistence_updated' ORDER BY created_at DESC, id DESC LIMIT 1`;
    // The audit writer redacts every key that names a token, `tokenChanged` included.
    expect(audit[0]!["details"]).toMatchObject({ via: "embedded_signup" });
    const text = JSON.stringify(audit) + h.logs.join("\n");
    for (const secret of [meta.token, body.code, body.phoneNumberId, META.META_APP_SECRET])
      expect(text).not.toContain(secret);
  });

  it("maps Meta's refusals and outages, and changes nothing", async () => {
    const A = await clinicWithMembers(h);
    const cases: [Error, "exchange" | "verify", number, object][] = [
      [
        new ApiError("validation", [{ path: ["code"], code: "meta_code_invalid" }]),
        "exchange",
        400,
        refusal("code", "meta_code_invalid"),
      ],
      [new ServiceUnavailableError(), "exchange", 503, {}],
      [
        new ApiError("validation", [{ path: ["phoneNumberId"], code: "meta_two_step_enabled" }]),
        "verify",
        400,
        refusal("phoneNumberId", "meta_two_step_enabled"),
      ],
      [
        new ApiError("validation", [{ path: ["accessToken"], code: "meta_credentials_invalid" }]),
        "verify",
        400,
        refusal("phoneNumberId", "meta_credentials_invalid"),
      ],
      [new ServiceUnavailableError(), "verify", 503, {}],
    ];
    for (const [error, where, status, shape] of cases) {
      if (where === "exchange") meta.exchangeError = error;
      else meta.error = error;
      try {
        const res = await signup(A.admin.cookie, request());
        expect(res.statusCode).toBe(status);
        expect(res.json()).toMatchObject(shape);
      } finally {
        meta.exchangeError = null;
        meta.error = null;
      }
      expect((await channel(A.admin.clinicId))?.["sealed_credentials"] ?? null).toBeNull();
    }
  });

  it("refuses another clinic's number before any Meta call, never naming that clinic", async () => {
    const A = await clinicWithMembers(h);
    const B = await clinicWithMembers(h);
    const body = request();
    expect((await signup(A.admin.cookie, body)).statusCode).toBe(200);
    const exchanges = meta.exchanges.length;
    const res = await signup(B.admin.cookie, { ...request(), phoneNumberId: body.phoneNumberId });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject(refusal("phoneNumberId", "number_in_use"));
    expect(res.body).not.toContain(A.admin.clinicId);
    expect(meta.exchanges.length).toBe(exchanges);
    // The manual form is refused the same way.
    const manual = await send(h, B.admin.cookie, "PUT", "/v1/clinic/whatsapp/coexistence", {
      accessToken: randomBytes(24).toString("hex"),
      phoneNumberId: body.phoneNumberId,
      businessAccountId: number(),
      templates: Object.fromEntries(
        Object.keys(DEFAULT_NOTIFICATION_SETTINGS.messages).map((kind) => [kind, null]),
      ),
    });
    expect(manual.statusCode).toBe(400);
    expect(manual.json()).toMatchObject(refusal("phoneNumberId", "number_in_use"));
  });

  it("a number another clinic keeps on another transport is decided by the unique index", async () => {
    const A = await clinicWithMembers(h);
    const B = await clinicWithMembers(h);
    const held = number();
    await h.owner`INSERT INTO clinic_whatsapp_channels (clinic_id, id, transport, status, phone_number_id,
        created_at, updated_at)
      VALUES (${B.admin.clinicId}, ${randomUUID()}, 'evolution', 'disconnected', ${held}, now(), now())`;
    const res = await signup(A.admin.cookie, { ...request(), phoneNumberId: held });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject(refusal("phoneNumberId", "number_in_use"));
    expect((await channel(A.admin.clinicId))?.["sealed_credentials"] ?? null).toBeNull();
  });

  it("is refused while an Evolution number is linked", async () => {
    const A = await clinicWithMembers(h);
    const link = { acceptRisk: true, riskVersion: WHATSAPP_RISK_VERSION };
    await send(h, A.admin.cookie, "POST", "/v1/clinic/whatsapp/connect", link);
    const res = await signup(A.admin.cookie, request());
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject(refusal("transport", "evolution_linked"));
  });

  it("validates the body and needs the update key", async () => {
    const A = await clinicWithMembers(h);
    for (const body of [
      { ...request(), wabaId: "12ab5" },
      { ...request(), code: "" },
      { ...request(), extra: true },
    ])
      expect((await signup(A.admin.cookie, body)).statusCode).toBe(400);
    expect((await signup(A.doctor.cookie, request())).statusCode).toBe(403);
  });
});
