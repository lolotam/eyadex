import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mailProvidersResponseSchema } from "@eyadex/contracts/mail-provider";

import {
  APP,
  call,
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";

// Phase 3 (N-3, ADR-0031): /v1/clinic/mail-providers and its two slots over HTTP; the old
// /v1/clinic/mail-provider routes stay as the primary's alias.
const API_KEY = "re_slots_recognisable_fake_key_345";
const PASSWORD = "slots-recognisable-fake-password-678";
const BASE = "/v1/clinic/mail-providers";
const ALIAS = "/v1/clinic/mail-provider";

const resend = { kind: "resend", apiKey: API_KEY, fromName: "Clinic", fromEmail: "p@example.test" };
const smtp = {
  kind: "smtp",
  host: "smtp.example.test",
  port: 587,
  user: "mailer",
  password: PASSWORD,
  fromName: "Clinic backup",
  fromEmail: "b@example.test",
};

let h: Harness;
type Clinic = Awaited<ReturnType<typeof clinicWithMembers>>;

const send = (
  method: "GET" | "PUT" | "DELETE" | "POST",
  cookie: string | undefined,
  url: string,
  options: { body?: unknown; key?: string; host?: string } = {},
) =>
  call(h, {
    method,
    url,
    host: options.host ?? APP,
    ...(cookie === undefined ? {} : { cookie }),
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { "idempotency-key": options.key ?? randomUUID() },
  });

const both = async (clinic: Clinic) =>
  mailProvidersResponseSchema.parse((await send("GET", clinic.admin.cookie, BASE)).json());

const slotOf = (clinicId: string) =>
  h.owner`SELECT slot, kind FROM clinic_mail_providers WHERE clinic_id = ${clinicId} ORDER BY slot`;

beforeAll(async () => {
  h = await openHarness({}, true);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("RBAC-01: every slot route", () => {
  const routes = [
    ["GET", BASE, undefined],
    ["GET", `${BASE}/primary`, undefined],
    ["PUT", `${BASE}/fallback`, resend],
    ["DELETE", `${BASE}/fallback`, undefined],
    ["POST", `${BASE}/fallback/test`, undefined],
  ] as const;

  it.each(routes)("%s %s: no session 401, doctor 403, platform host 404", async (m, url, body) => {
    const A = await clinicWithMembers(h);
    expect((await send(m, undefined, url, { body })).statusCode).toBe(401);
    expect((await send(m, A.doctor.cookie, url, { body })).statusCode).toBe(403);
    expect((await send(m, A.admin.cookie, url, { body, host: PLATFORM })).statusCode).toBe(404);
  });
});

describe("mail provider slots over HTTP", () => {
  it("a fallback without a primary is refused (validation, slot)", async () => {
    const A = await clinicWithMembers(h);
    const res = await send("PUT", A.admin.cookie, `${BASE}/fallback`, { body: smtp });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "validation",
      details: [{ path: ["slot"], code: "fallback_without_primary" }],
    });
    expect(await both(A)).toEqual({ primary: null, fallback: null });
  });

  it("saves both slots; the old route reads and writes the primary only", async () => {
    const A = await clinicWithMembers(h);
    expect((await send("PUT", A.admin.cookie, ALIAS, { body: resend })).statusCode).toBe(200);
    expect((await send("PUT", A.admin.cookie, `${BASE}/fallback`, { body: smtp })).statusCode).toBe(
      200,
    );
    expect(await both(A)).toMatchObject({
      primary: { kind: "resend", fromEmail: "p@example.test" },
      fallback: { kind: "smtp", smtpHost: "smtp.example.test" },
    });
    expect((await send("GET", A.admin.cookie, ALIAS)).json()).toMatchObject({ kind: "resend" });
    expect((await send("GET", A.admin.cookie, `${BASE}/fallback`)).json()).toMatchObject({
      kind: "smtp",
    });
    expect(await slotOf(A.admin.clinicId)).toEqual([
      { slot: "fallback", kind: "smtp" },
      { slot: "primary", kind: "resend" },
    ]);
    const audit = await h.owner`SELECT details FROM audit_log WHERE clinic_id = ${A.admin.clinicId}
                                AND action = 'clinic.mail_provider_updated' ORDER BY created_at, id`;
    expect(audit.map((r) => (r["details"] as { slot: string }).slot)).toEqual([
      "primary",
      "fallback",
    ]);
    for (const text of [JSON.stringify(audit), JSON.stringify(await both(A))]) {
      expect(text).not.toContain(API_KEY);
      expect(text).not.toContain(PASSWORD);
    }
  });

  it("the primary cannot be removed while a fallback exists; the fallback can", async () => {
    const A = await clinicWithMembers(h);
    await send("PUT", A.admin.cookie, `${BASE}/primary`, { body: resend });
    await send("PUT", A.admin.cookie, `${BASE}/fallback`, { body: smtp });
    for (const url of [`${BASE}/primary`, ALIAS]) {
      const refused = await send("DELETE", A.admin.cookie, url);
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({
        code: "validation",
        details: [{ path: ["slot"], code: "primary_has_fallback" }],
      });
    }
    expect((await send("DELETE", A.admin.cookie, `${BASE}/fallback`)).statusCode).toBe(204);
    expect((await send("DELETE", A.admin.cookie, `${BASE}/primary`)).statusCode).toBe(204);
    expect(await both(A)).toEqual({ primary: null, fallback: null });
    const removed = await h.owner`SELECT details FROM audit_log
      WHERE clinic_id = ${A.admin.clinicId} AND action = 'clinic.mail_provider_removed'
      ORDER BY created_at, id`;
    expect(removed.map((r) => (r["details"] as { slot: string }).slot)).toEqual([
      "fallback",
      "primary",
    ]);
  });

  it("a test of the fallback carries the slot; a missing slot provider is 404", async () => {
    const A = await clinicWithMembers(h);
    expect((await send("POST", A.admin.cookie, `${BASE}/fallback/test`)).statusCode).toBe(404);
    await send("PUT", A.admin.cookie, `${BASE}/primary`, { body: resend });
    await send("PUT", A.admin.cookie, `${BASE}/fallback`, { body: smtp });
    expect((await send("POST", A.admin.cookie, `${BASE}/fallback/test`)).statusCode).toBe(202);
    const [fallback] = await h.owner`SELECT id FROM clinic_mail_providers
      WHERE clinic_id = ${A.admin.clinicId} AND slot = 'fallback'`;
    const events = await h.owner`SELECT payload FROM outbox_events
      WHERE clinic_id = ${A.admin.clinicId} AND event_type = 'clinic.mail_provider_test_requested'`;
    expect(events).toHaveLength(1);
    expect(events[0]!["payload"]).toMatchObject({ providerId: fallback!["id"], slot: "fallback" });
    // One test per clinic per minute, whichever slot.
    const again = await send("POST", A.admin.cookie, `${BASE}/primary/test`);
    expect(again.statusCode).toBe(429);
  });

  it("one Idempotency-Key sent to both slots never replays the other slot's answer", async () => {
    const A = await clinicWithMembers(h);
    const key = randomUUID();
    await send("PUT", A.admin.cookie, `${BASE}/primary`, { body: resend, key });
    const fallback = await send("PUT", A.admin.cookie, `${BASE}/fallback`, { body: resend, key });
    expect(fallback.statusCode).toBe(200);
    expect(await slotOf(A.admin.clinicId)).toHaveLength(2);
  });

  it("an unknown slot is 404; another clinic's slots are invisible", async () => {
    const A = await clinicWithMembers(h);
    const B = await clinicWithMembers(h);
    await send("PUT", A.admin.cookie, `${BASE}/primary`, { body: resend });
    expect((await send("GET", A.admin.cookie, `${BASE}/backup`)).statusCode).toBe(404);
    expect((await send("PUT", A.admin.cookie, `${BASE}/backup`, { body: resend })).statusCode).toBe(
      404,
    );
    expect(await both(B)).toEqual({ primary: null, fallback: null });
    expect((await send("DELETE", B.admin.cookie, `${BASE}/primary`)).statusCode).toBe(204);
    expect((await both(A)).primary).not.toBeNull();
  });
});
