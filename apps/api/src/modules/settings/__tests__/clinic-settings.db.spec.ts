import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  APP,
  call,
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers, get } from "../../identity/__tests__/access-fixtures.ts";
import { CLOCK } from "../../tenancy/index.ts";

// ADR-0020: /v1/clinic/settings (story 55), /v1/account (story 64) and the /v1/me banner (story 30),
// over HTTP through the global access guard, on real PostgreSQL with RLS.
let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;
let B: Awaited<ReturnType<typeof clinicWithMembers>>;

const put = (url: string, cookie: string | undefined, body: unknown, host = APP) =>
  call(h, { method: "PUT", url, host, body, ...(cookie === undefined ? {} : { cookie }) });

const settings = {
  nameAr: "عيادة النور 96550001234",
  nameEn: "Noor Clinic",
  defaultLanguage: "en",
  timezone: "Asia/Riyadh",
};

const clinicRow = async (id: string) =>
  (
    await h.owner`SELECT name_ar, name_en, default_language, timezone, status, expires_at
                 FROM clinics WHERE id = ${id}`
  )[0]!;

const auditRows = async (clinicId: string, action: string) =>
  h.owner<{ details: { before: unknown; after: unknown }; entity_type: string }[]>`
    SELECT details, entity_type FROM audit_log WHERE clinic_id = ${clinicId} AND action = ${action}
    ORDER BY created_at`;

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await clinicWithMembers(h);
  B = await clinicWithMembers(h);
});

afterAll(async () => {
  await closeHarness(h);
});

describe("clinic settings (story 55)", () => {
  it("the admin reads and saves names, language and time zone; the change is audited and scrubbed", async () => {
    const before = await get(h, "/v1/clinic/settings", A.admin.cookie);
    expect(before.statusCode).toBe(200);
    expect(Object.keys(before.json()).sort()).toEqual(
      ["defaultLanguage", "nameAr", "nameEn", "slug", "specialty", "timezone"].sort(),
    );
    const saved = await put("/v1/clinic/settings", A.admin.cookie, settings);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ ...settings, slug: before.json().slug });
    const row = await clinicRow(A.admin.clinicId);
    expect(row).toMatchObject({
      name_en: "Noor Clinic",
      default_language: "en",
      timezone: "Asia/Riyadh",
    });
    const [audit] = await auditRows(A.admin.clinicId, "clinic.settings_updated");
    expect(audit!.entity_type).toBe("clinic");
    expect(audit!.details.after).toMatchObject({ nameEn: "Noor Clinic", timezone: "Asia/Riyadh" });
    // A number typed into a name never reaches the append-only log in full.
    expect(JSON.stringify(audit!.details)).not.toContain("96550001234");
    // The session snapshot is invalidated: /v1/me shows the new names at once.
    const me = await get(h, "/v1/me", A.admin.cookie);
    expect(me.json().clinic).toMatchObject({ nameEn: "Noor Clinic", timezone: "Asia/Riyadh" });
  });

  it("NEGATIVE: status, expiry, slug or an unknown zone cannot be written; nothing changes", async () => {
    const row = await clinicRow(A.admin.clinicId);
    for (const extra of [
      { status: "active" },
      { expiresAt: "2099-01-01T00:00:00Z" },
      { slug: "x-y" },
    ]) {
      const res = await put("/v1/clinic/settings", A.admin.cookie, { ...settings, ...extra });
      expect(res.statusCode).toBe(400);
    }
    const zone = await put("/v1/clinic/settings", A.admin.cookie, {
      ...settings,
      timezone: "Mars/Base",
    });
    expect(zone.statusCode).toBe(400);
    expect(await clinicRow(A.admin.clinicId)).toEqual(row);
  });

  it("RBAC-01: a member without the permission is refused, and clinic B is never touched", async () => {
    expect((await get(h, "/v1/clinic/settings", A.doctor.cookie)).statusCode).toBe(403);
    expect((await put("/v1/clinic/settings", A.doctor.cookie, settings)).statusCode).toBe(403);
    expect((await get(h, "/v1/clinic/settings")).statusCode).toBe(401);
    expect((await get(h, "/v1/clinic/settings", A.admin.cookie, PLATFORM)).statusCode).toBe(404);
    const other = await clinicRow(B.admin.clinicId);
    expect(other["name_en"]).not.toBe("Noor Clinic");
    expect(await auditRows(B.admin.clinicId, "clinic.settings_updated")).toHaveLength(0);
  });
});

describe("my account (story 64)", () => {
  it("any active member reads and saves its own name and language; audited on its membership", async () => {
    const view = await get(h, "/v1/account", A.doctor.cookie);
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({ email: A.doctor.email });
    const saved = await put("/v1/account", A.doctor.cookie, {
      fullName: "Dr Sara 96551234567",
      preferredLanguage: "en",
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      fullName: "Dr Sara 96551234567",
      preferredLanguage: "en",
    });
    const [member] = await h.owner`SELECT id, full_name, preferred_language FROM memberships
                                   WHERE user_id = ${A.doctor.userId}`;
    expect(member).toMatchObject({ full_name: "Dr Sara 96551234567", preferred_language: "en" });
    const [audit] = await h.owner<{ entity_id: string; details: unknown }[]>`
      SELECT entity_id, details FROM audit_log
      WHERE clinic_id = ${A.doctor.clinicId} AND action = 'user.profile_updated'`;
    expect(audit!.entity_id).toBe(member!["id"]);
    expect(JSON.stringify(audit!.details)).not.toContain("96551234567");
    expect((await get(h, "/v1/me", A.doctor.cookie)).json().user.fullName).toBe(
      "Dr Sara 96551234567",
    );
  });

  it("NEGATIVE: the body cannot name another member or change the email; no session → 401", async () => {
    const res = await put("/v1/account", A.doctor.cookie, {
      fullName: "x y",
      preferredLanguage: "ar",
      email: "other@example.test",
    });
    expect(res.statusCode).toBe(400);
    expect(
      (await put("/v1/account", undefined, { fullName: "x y", preferredLanguage: "ar" }))
        .statusCode,
    ).toBe(401);
    const [admin] =
      await h.owner`SELECT full_name FROM memberships WHERE user_id = ${A.admin.userId}`;
    expect(admin!["full_name"]).not.toBe("x y");
  });
});

describe("expiry banner (story 30)", () => {
  it("expiresInDays follows the platform alert window on the API clock, and is null outside it", async () => {
    const clock = h.app.get<{ now: () => Date }>(CLOCK);
    const real = clock.now;
    const expiresAt = new Date((await clinicRow(B.admin.clinicId))["expires_at"]);
    try {
      clock.now = () => new Date(expiresAt.getTime() - 5 * 24 * 3600 * 1000 + 60_000);
      expect((await get(h, "/v1/me", B.admin.cookie)).json().expiresInDays).toBe(5);
      await h.owner`UPDATE platform_settings SET alert_days_before_expiry = 3`;
      expect((await get(h, "/v1/me", B.admin.cookie)).json().expiresInDays).toBeNull();
    } finally {
      clock.now = real;
      await h.owner`UPDATE platform_settings SET alert_days_before_expiry = 7`;
    }
  });
});
