import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_NOTIFICATION_SETTINGS,
  notificationSettingsSchema,
  type NotificationSettings,
} from "@eyadex/contracts/notifications";

import {
  APP,
  call,
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";

// Phase 3 N1 (N-1, ADR-0031): GET/PUT /v1/clinic/notification-settings over HTTP.
const URL = "/v1/clinic/notification-settings";

let h: Harness;

const send = (
  method: "GET" | "PUT",
  cookie: string | undefined,
  options: { body?: unknown; host?: string } = {},
) =>
  call(h, {
    method,
    url: URL,
    host: options.host ?? APP,
    ...(cookie === undefined ? {} : { cookie }),
    ...(options.body === undefined ? {} : { body: options.body }),
  });

const quiet: NotificationSettings = {
  emailEnabled: true,
  messages: { ...DEFAULT_NOTIFICATION_SETTINGS.messages, reminder_2h: false, prescription: false },
};

const auditOf = (clinicId: string) =>
  h.owner`SELECT action, category, entity_type, entity_id, details FROM audit_log
          WHERE clinic_id = ${clinicId} AND action = 'clinic.notification_settings_updated'
          ORDER BY created_at, id`;

beforeAll(async () => {
  h = await openHarness({}, true);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("RBAC-01: the notification settings routes", () => {
  it.each(["GET", "PUT"] as const)(
    "%s: no session 401, doctor 403, platform host 404",
    async (method) => {
      const A = await clinicWithMembers(h);
      const body = method === "PUT" ? quiet : undefined;
      expect((await send(method, undefined, { body })).statusCode).toBe(401);
      expect((await send(method, A.doctor.cookie, { body })).statusCode).toBe(403);
      expect((await send(method, A.admin.cookie, { body, host: PLATFORM })).statusCode).toBe(404);
    },
  );
});

describe("clinic notification settings", () => {
  it("a clinic that never saved reads the defaults", async () => {
    const A = await clinicWithMembers(h);
    const res = await send("GET", A.admin.cookie);
    expect(res.statusCode).toBe(200);
    expect(notificationSettingsSchema.parse(res.json())).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it("PUT saves one row and audits before and after on the clinic; the same values again write nothing", async () => {
    const A = await clinicWithMembers(h);
    const clinicId = A.admin.clinicId;
    const saved = await send("PUT", A.admin.cookie, { body: quiet });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual(quiet);
    expect((await send("GET", A.admin.cookie)).json()).toEqual(quiet);
    const off = { ...quiet, emailEnabled: false };
    expect((await send("PUT", A.admin.cookie, { body: off })).json()).toEqual(off);
    expect((await send("PUT", A.admin.cookie, { body: off })).statusCode).toBe(200);
    const rows = await h.owner`SELECT email_enabled, reminder_2h, prescription, booked
      FROM clinic_notification_settings WHERE clinic_id = ${clinicId}`;
    expect(rows).toEqual([
      { email_enabled: false, reminder_2h: false, prescription: false, booked: true },
    ]);
    const audit = await auditOf(clinicId);
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({
      category: "administrative",
      entity_type: "clinic",
      entity_id: clinicId,
      details: { before: DEFAULT_NOTIFICATION_SETTINGS, after: quiet },
    });
    expect(audit[1]).toMatchObject({ details: { before: quiet, after: off } });
  });

  it("refuses a body that is not the whole contract shape", async () => {
    const A = await clinicWithMembers(h);
    const partial = { emailEnabled: true, messages: { booked: true } };
    const extra = { ...quiet, whatsappEnabled: true };
    for (const body of [partial, extra, { ...quiet, emailEnabled: "yes" }]) {
      expect((await send("PUT", A.admin.cookie, { body })).statusCode).toBe(400);
    }
    expect(await auditOf(A.admin.clinicId)).toHaveLength(0);
  });

  it("one clinic's save never changes another clinic's settings", async () => {
    const A = await clinicWithMembers(h);
    const B = await clinicWithMembers(h);
    await send("PUT", A.admin.cookie, { body: { ...quiet, emailEnabled: false } });
    expect((await send("GET", B.admin.cookie)).json()).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });
});
