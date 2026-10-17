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
import { CLOCK } from "../../tenancy/index.ts";
import { platformStaff } from "./platform-staff.ts";

// ADR-0020: the overview with the computed "expired" state (stories 3–4, SUB-02), the effective status
// filter, platform settings (story 26) and the signed-in account, over HTTP on the platform host.
let h: Harness;
let staff: Awaited<ReturnType<typeof platformStaff>>;
const NOW = new Date("2032-03-10T12:00:00Z");
const DAY = 24 * 3600 * 1000;

const send = (
  method: "GET" | "PUT",
  url: string,
  options: { body?: unknown; cookie?: string; host?: string } = {},
) =>
  call(h, {
    method,
    url,
    host: options.host ?? PLATFORM,
    cookie: options.cookie ?? staff.cookie,
    ...(options.body === undefined ? {} : { body: options.body }),
  });

async function clinic(status: "trial" | "active" | "suspended", expiresInMs: number) {
  const id = randomUUID();
  await h.owner`INSERT INTO clinics VALUES (${id}, ${`ov-${id.slice(0, 8)}`}, 'ع', 'C', 'general',
    'ar', 'Asia/Kuwait', ${status}, ${new Date(NOW.getTime() + expiresInMs).toISOString()},
    10, 3, now(), now())`;
  return id;
}

beforeAll(async () => {
  h = await openHarness({}, true);
  staff = await platformStaff(h);
  h.app.get<{ now: () => Date }>(CLOCK).now = () => NOW;
});

afterAll(async () => {
  await h.owner`UPDATE platform_settings SET default_trial_days = 14, alert_days_before_expiry = 7,
    email_sender_name = 'Eyadex', default_max_users = 10, default_max_branches = 3,
    default_module_patients = true, default_module_appointments = true,
    default_module_medical = true`;
  await closeHarness(h);
});

describe("overview (stories 3–4)", () => {
  it("counts every effective status, with expired computed at the API clock, never stored", async () => {
    const before = (await send("GET", "/v1/platform/overview")).json().counts;
    await clinic("trial", 30 * DAY);
    await clinic("active", 30 * DAY);
    await clinic("suspended", -5 * DAY);
    await clinic("trial", 0); // expires exactly now: access already ended
    await clinic("active", -DAY);
    const res = await send("GET", "/v1/platform/overview");
    expect(res.statusCode).toBe(200);
    const after = res.json().counts;
    expect(after.trial - before.trial).toBe(1);
    expect(after.active - before.active).toBe(1);
    expect(after.suspended - before.suspended).toBe(1);
    expect(after.expired - before.expired).toBe(2);
    expect(Object.keys(res.json()).sort()).toEqual([
      "alertDaysBeforeExpiry",
      "counts",
      "expiringSoon",
    ]);
  });

  it("lists clinics inside the alert window only, soonest first, with whole days left", async () => {
    const soon = await clinic("trial", 2 * DAY - 60_000);
    const later = await clinic("active", 6 * DAY);
    const outside = await clinic("active", 8 * DAY);
    const suspended = await clinic("suspended", DAY);
    const res = (await send("GET", "/v1/platform/overview")).json();
    expect(res.alertDaysBeforeExpiry).toBe(7);
    const ids = res.expiringSoon.map((c: { id: string }) => c.id);
    expect(ids.indexOf(soon)).toBeLessThan(ids.indexOf(later));
    expect(ids).not.toContain(outside);
    expect(ids).not.toContain(suspended);
    const item = res.expiringSoon.find((c: { id: string }) => c.id === soon);
    expect(item).toEqual({
      id: soon,
      nameAr: "ع",
      nameEn: "C",
      status: "trial",
      expiresAt: new Date(NOW.getTime() + 2 * DAY - 60_000).toISOString(),
      daysLeft: 2,
    });
  });

  it("the clinic list filters by effective status: trial and active leave out expired clinics", async () => {
    const expiredTrial = await clinic("trial", -DAY);
    const liveTrial = await clinic("trial", DAY * 40);
    const ids = async (status: string) =>
      (await send("GET", `/v1/platform/clinics?status=${status}&limit=100`))
        .json()
        .items.map((c: { id: string }) => c.id);
    expect(await ids("expired")).toContain(expiredTrial);
    expect(await ids("expired")).not.toContain(liveTrial);
    expect(await ids("trial")).toContain(liveTrial);
    expect(await ids("trial")).not.toContain(expiredTrial);
  });
});

describe("platform settings (story 26)", () => {
  it("reads the seeded values, saves new ones and audits before and after", async () => {
    const res = await send("GET", "/v1/platform/settings");
    expect(res.json()).toEqual({
      defaultTrialDays: 14,
      alertDaysBeforeExpiry: 7,
      emailSenderName: "Eyadex",
      defaultMaxUsers: 10,
      defaultMaxBranches: 3,
      // R2-3: the release (0050) turned the medical default on.
      defaultModules: { patients: true, appointments: true, medical: true, finance: false },
    });
    const next = {
      defaultTrialDays: 30,
      alertDaysBeforeExpiry: 10,
      emailSenderName: "Eyadex Team",
      defaultMaxUsers: 25,
      defaultMaxBranches: 5,
      defaultModules: { patients: false, appointments: false, medical: false, finance: false },
    };
    const saved = await send("PUT", "/v1/platform/settings", { body: next });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual(next);
    const [audit] = await h.owner<
      { actor_user_id: string; clinic_id: string | null; details: unknown }[]
    >`
      SELECT actor_user_id, clinic_id, details FROM platform_audit_log
      WHERE action = 'platform.settings_updated' AND actor_user_id = ${staff.actorId}`;
    expect(audit).toMatchObject({ actor_user_id: staff.actorId, clinic_id: null });
    expect(audit!.details).toEqual({
      before: {
        defaultTrialDays: 14,
        alertDaysBeforeExpiry: 7,
        emailSenderName: "Eyadex",
        defaultMaxUsers: 10,
        defaultMaxBranches: 3,
        defaultModules: { patients: true, appointments: true, medical: true, finance: false },
      },
      after: next,
    });
    expect((await send("GET", "/v1/platform/settings")).json()).toEqual(next);
    expect((await send("GET", "/v1/platform/overview")).json().alertDaysBeforeExpiry).toBe(10);
  });

  it("NEGATIVE: out-of-range values, a header line break, a missing or an extra field are 400; nothing changes", async () => {
    const good = {
      defaultTrialDays: 30,
      alertDaysBeforeExpiry: 10,
      emailSenderName: "Eyadex Team",
      defaultMaxUsers: 25,
      defaultMaxBranches: 5,
      defaultModules: { patients: false, appointments: false, medical: false, finance: false },
    };
    const { defaultModules: _drop, ...noModule } = good;
    void _drop;
    for (const body of [
      { ...good, defaultTrialDays: 0 },
      { ...good, alertDaysBeforeExpiry: 61 },
      { ...good, emailSenderName: "Eyadex\r\nBcc: someone@example.test" },
      { ...good, id: 2 },
      { ...good, defaultMaxUsers: 0 },
      { ...good, defaultMaxUsers: 1001 },
      { ...good, defaultMaxBranches: 101 },
      { ...good, defaultMaxBranches: 2.5 },
      { ...good, defaultModules: { patients: "yes" } },
      { ...good, defaultModules: {} },
      { ...good, defaultModules: { patients: true, billing: true } },
      noModule,
    ]) {
      expect((await send("PUT", "/v1/platform/settings", { body })).statusCode).toBe(400);
    }
    expect((await send("GET", "/v1/platform/settings")).json()).toEqual(good);
  });

  // P2 R2-3, R3-6c: since the release (0050) the platform may turn the medical default on, and off again.
  it("turns the medical default on and off after the release", async () => {
    const before = (await send("GET", "/v1/platform/settings")).json();
    for (const medical of [true, false]) {
      const body = {
        ...before,
        defaultModules: { ...before.defaultModules, patients: true, medical },
      };
      expect((await send("PUT", "/v1/platform/settings", { body })).statusCode).toBe(200);
      expect((await send("GET", "/v1/platform/settings")).json()).toEqual(body);
    }
  });

  it("reads an incoherent stored row and allows staff to repair it", async () => {
    const before = (await send("GET", "/v1/platform/settings")).json();
    try {
      await h.owner`UPDATE platform_settings SET default_module_patients = false,
        default_module_medical = true WHERE id = 1`;
      const response = await send("GET", "/v1/platform/settings");
      expect(response.statusCode).toBe(200);
      expect(response.json().defaultModules).toMatchObject({
        patients: false,
        medical: true,
        finance: false,
      });
      const rejected = await send("PUT", "/v1/platform/settings", { body: response.json() });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().code).toBe("validation");
    } finally {
      expect((await send("PUT", "/v1/platform/settings", { body: before })).statusCode).toBe(200);
    }
  });

  it("NEGATIVE: the clinic host answers 404 and a session without TOTP 403", async () => {
    for (const url of ["/v1/platform/settings", "/v1/platform/overview", "/v1/platform/me"]) {
      expect((await send("GET", url, { host: APP })).statusCode).toBe(404);
      const res = await send("GET", url, { cookie: staff.noTotpCookie });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("two_factor_required");
    }
  });
});

describe("the signed-in account", () => {
  it("answers the account's id, name and email, nothing else", async () => {
    const res = await send("GET", "/v1/platform/me");
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(["email", "fullName", "id"]);
  });
});
