import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  APP,
  call,
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";

// ADR-0014 (7c-2a): /v1/clinic/mail-provider over HTTP, through the global access guard.
const API_KEY = "re_http_recognisable_fake_key_789";
const PASSWORD = "http-recognisable-fake-password-012";
const URL = "/v1/clinic/mail-provider";

const resend = { kind: "resend", apiKey: API_KEY, fromName: "Clinic", fromEmail: "c@example.test" };
const smtp = {
  kind: "smtp",
  host: "smtp.example.test",
  port: 587,
  user: "mailer",
  password: PASSWORD,
  fromName: "Clinic",
  fromEmail: "c@example.test",
};

let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;
let B: Awaited<ReturnType<typeof clinicWithMembers>>;

const send = (
  method: "GET" | "PUT" | "DELETE" | "POST",
  cookie: string | undefined,
  options: { body?: unknown; key?: string | null; url?: string; host?: string } = {},
) =>
  call(h, {
    method,
    url: options.url ?? URL,
    host: options.host ?? APP,
    ...(cookie === undefined ? {} : { cookie }),
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: options.key === null ? {} : { "idempotency-key": options.key ?? randomUUID() },
  });

const routes = [
  ["GET", URL, undefined],
  ["PUT", URL, resend],
  ["DELETE", URL, undefined],
  ["POST", `${URL}/test`, undefined],
] as const;

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await clinicWithMembers(h);
  B = await clinicWithMembers(h);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("RBAC-01: every mail-provider route", () => {
  it.each(routes)("%s %s: no session 401, doctor 403, platform host 404", async (method, url, body) => {
    expect((await send(method, undefined, { url, body })).statusCode).toBe(401);
    expect((await send(method, A.doctor.cookie, { url, body })).statusCode).toBe(403);
    expect((await send(method, A.admin.cookie, { url, body, host: PLATFORM })).statusCode).toBe(404);
  });
});

describe("mail provider over HTTP", () => {
  it("PUT without Idempotency-Key is 400; test-send without a provider is 404", async () => {
    expect((await send("PUT", A.admin.cookie, { body: resend, key: null })).statusCode).toBe(400);
    expect((await send("POST", A.admin.cookie, { url: `${URL}/test` })).statusCode).toBe(404);
    expect((await send("POST", A.admin.cookie, { url: `${URL}/test`, key: null })).statusCode).toBe(400);
  });

  it("GET, PUT replies, audit rows and logs never contain the secret", async () => {
    expect((await send("PUT", A.admin.cookie, { body: resend })).statusCode).toBe(200);
    const put = await send("PUT", A.admin.cookie, { body: smtp });
    expect(put.statusCode).toBe(200);
    const view = await send("GET", A.admin.cookie);
    expect(view.json()).toMatchObject({ kind: "smtp", smtpHost: "smtp.example.test", hasCredentials: true });
    const audit = JSON.stringify(
      await h.owner`SELECT details FROM audit_log WHERE clinic_id = ${A.admin.clinicId}
                    AND action LIKE 'clinic.mail_provider%'`,
    );
    for (const text of [put.body, view.body, audit, h.logs.join("\n")]) {
      expect(text).not.toContain(API_KEY);
      expect(text).not.toContain(PASSWORD);
    }
  });

  it("test-send answers 202 and writes one id-only event", async () => {
    const res = await send("POST", A.admin.cookie, { url: `${URL}/test` });
    expect(res.statusCode).toBe(202);
    const events = await h.owner`SELECT payload FROM outbox_events WHERE clinic_id = ${A.admin.clinicId}
                                 AND event_type = 'clinic.mail_provider_test_requested'`;
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]!["payload"] as object).sort()).toEqual([
      "actorUserId",
      "clinicId",
      "providerId",
    ]);
  });

  it("another clinic's provider is invisible, and DELETE removes only its own", async () => {
    expect((await send("GET", B.admin.cookie)).json()).toBeNull();
    expect((await send("DELETE", B.admin.cookie)).statusCode).toBe(204);
    expect((await send("GET", A.admin.cookie)).json()).not.toBeNull();
    expect((await send("DELETE", A.admin.cookie)).statusCode).toBe(204);
    expect((await send("GET", A.admin.cookie)).json()).toBeNull();
  });
});
