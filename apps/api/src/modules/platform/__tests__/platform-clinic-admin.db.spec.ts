import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@eyadex/db";

import { DATABASE } from "../../../shared/database.provider.ts";
import { PgSeatUsageReader } from "../../identity/index.ts";
import {
  CLOCK,
  limitReachedDetails,
  PgClinicReader,
  ReaderClinicLimits,
  type Clock,
} from "../../tenancy/index.ts";
import {
  APP,
  call,
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers, get } from "../../identity/__tests__/access-fixtures.ts";
import { platformStaff } from "./platform-staff.ts";

// FLAG-01, FLAG-02, SUB-01, SUB-02 and story 18 over HTTP on real PostgreSQL + Redis (ADR-0010).
let h: Harness;
let staff: Awaited<ReturnType<typeof platformStaff>>;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;

beforeAll(async () => {
  h = await openHarness({}, true);
  staff = await platformStaff(h);
  A = await clinicWithMembers(h);
});

afterAll(async () => {
  await closeHarness(h);
});

type Method = "GET" | "PUT" | "PATCH";
const platform = (
  method: Method,
  path: string,
  body?: unknown,
  cookie = staff.cookie,
  host = PLATFORM,
) =>
  call(h, {
    method,
    url: `/v1/platform/clinics/${path}`,
    host,
    cookie,
    ...(body === undefined ? {} : { body }),
  });
const code = (res: { json: () => unknown }) => (res.json() as { code?: string }).code;
const clinic = () => A.admin.clinicId;
const audits = (action: string) =>
  h.owner`SELECT actor_user_id, details FROM platform_audit_log
          WHERE clinic_id = ${clinic()} AND action = ${action} ORDER BY created_at`;
const keyed = (body: unknown, key: string) =>
  call(h, {
    method: "PATCH",
    url: `/v1/platform/clinics/${clinic()}/subscription`,
    host: PLATFORM,
    cookie: staff.cookie,
    headers: { "idempotency-key": key },
    body,
  });
const permissionsOf = async (cookie: string) => (await get(h, "/v1/me", cookie)).json().permissions;

describe("every platform endpoint", () => {
  const routes: [Method, string, unknown][] = [
    ["GET", "", undefined],
    ["PUT", "/features/patients", { enabled: true }],
    ["PATCH", "/subscription", { status: "trial" }],
    ["PATCH", "/limits", { maxUsers: 5 }],
  ];

  it("NEGATIVE: clinic host → 404, no session → 401, no TOTP → two_factor_required", async () => {
    for (const [method, suffix, body] of routes) {
      const path = `${clinic()}${suffix}`;
      expect((await platform(method, path, body, staff.cookie, APP)).statusCode, path).toBe(404);
      const anonymous = await call(h, {
        method,
        url: `/v1/platform/clinics/${path}`,
        host: PLATFORM,
        ...(body === undefined ? {} : { body }),
      });
      expect(anonymous.statusCode, path).toBe(401);
      const noTotp = await platform(method, path, body, staff.noTotpCookie);
      expect(noTotp.statusCode, path).toBe(403);
      expect(code(noTotp), path).toBe("two_factor_required");
    }
  });

  it("NEGATIVE: unknown or malformed clinic and unknown module → 404, nothing written", async () => {
    const before = await h.owner`SELECT count(*)::int AS n FROM platform_audit_log`;
    for (const [method, suffix, body] of routes) {
      expect((await platform(method, `${randomUUID()}${suffix}`, body)).statusCode).toBe(404);
      expect((await platform(method, `not-a-uuid${suffix}`, body)).statusCode).toBe(404);
    }
    const unknownModule = await platform("PUT", `${clinic()}/features/finance`, { enabled: true });
    expect(unknownModule.statusCode).toBe(404);
    const after = await h.owner`SELECT count(*)::int AS n FROM platform_audit_log`;
    expect(after[0]!["n"]).toBe(before[0]!["n"]);
  });
});

describe("FLAG-01 / FLAG-02: locking a module hides it, re-enabling restores it exactly", () => {
  it("locks, then restores the same permissions (role rows never deleted)", async () => {
    const adminBefore = await permissionsOf(A.admin.cookie);
    const rowsBefore =
      await h.owner`SELECT count(*)::int AS n FROM role_permissions WHERE clinic_id = ${clinic()}`;
    expect((await get(h, "/v1/probe-patients", A.doctor.cookie)).statusCode).toBe(200);

    const locked = await platform("PUT", `${clinic()}/features/patients`, { enabled: false });
    expect(locked.statusCode).toBe(200);
    expect(locked.json().modules).toEqual({ patients: false });

    const probe = await get(h, "/v1/probe-patients", A.doctor.cookie);
    expect(probe.statusCode).toBe(403);
    expect(code(probe)).toBe("module_disabled");
    const me = (await get(h, "/v1/me", A.doctor.cookie)).json();
    expect(me.permissions).toEqual([]);
    expect(me.modules).toEqual([]);
    expect(await permissionsOf(A.admin.cookie)).toEqual(
      adminBefore.filter((k: string) => !k.includes(":patients:")),
    );
    const catalogue = (await get(h, "/v1/permissions/catalogue", A.admin.cookie)).json();
    expect(catalogue.modules.map((m: { module: unknown }) => m.module)).toEqual([null]);
    const rowsLocked =
      await h.owner`SELECT count(*)::int AS n FROM role_permissions WHERE clinic_id = ${clinic()}`;
    expect(rowsLocked[0]!["n"]).toBe(rowsBefore[0]!["n"]);

    const restored = await platform("PUT", `${clinic()}/features/patients`, { enabled: true });
    expect(restored.json().modules).toEqual({ patients: true });
    expect(await permissionsOf(A.doctor.cookie)).toEqual(["view:patients:branch"]);
    expect(await permissionsOf(A.admin.cookie)).toEqual(adminBefore);
    expect((await get(h, "/v1/probe-patients", A.doctor.cookie)).statusCode).toBe(200);

    const rows = await audits("clinic.feature_changed");
    expect(rows.map((r) => r["details"])).toEqual([
      { module: "patients", before: { enabled: true }, after: { enabled: false } },
      { module: "patients", before: { enabled: false }, after: { enabled: true } },
    ]);
    expect(rows.every((r) => r["actor_user_id"] === staff.actorId)).toBe(true);
  });
});

describe("SUB-01 / SUB-02: subscription changes through the platform API", () => {
  it("suspending blocks an existing session on the next request; reactivating restores it", async () => {
    const suspended = await platform("PATCH", `${clinic()}/subscription`, { status: "suspended" });
    expect(suspended.json()).toMatchObject({ status: "suspended", access: "suspended" });
    const blocked = await get(h, "/v1/me", A.admin.cookie);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({
      code: "subscription_blocked",
      details: { reason: "suspended" },
    });
    await platform("PATCH", `${clinic()}/subscription`, { status: "active" });
    expect((await get(h, "/v1/me", A.admin.cookie)).statusCode).toBe(200);
    const [first] = await audits("clinic.subscription_changed");
    expect(Object.keys(first!["details"] as object).sort()).toEqual(["after", "before"]);
    expect((first!["details"] as { after: object }).after).toMatchObject({ status: "suspended" });
  });

  it("durationDays counts from the injected clock; passing it blocks with no job", async () => {
    const clock = h.app.get<Clock>(CLOCK);
    const real = clock.now;
    const start = new Date("2030-01-01T00:00:00Z");
    clock.now = () => start;
    try {
      const res = await keyed({ durationDays: 30 }, randomUUID());
      expect(res.json()).toMatchObject({
        expiresAt: "2030-01-31T00:00:00.000Z",
        access: "allowed",
      });
      expect((await get(h, "/v1/me", A.admin.cookie)).statusCode).toBe(200);
      clock.now = () => new Date("2030-01-31T00:00:00Z");
      const blocked = await get(h, "/v1/me", A.admin.cookie);
      expect(blocked.json()).toMatchObject({
        code: "subscription_blocked",
        details: { reason: "expired" },
      });
    } finally {
      clock.now = real;
    }
  });

  it("an explicit past expiresAt is accepted and blocks; both inputs together are refused", async () => {
    const past = await platform("PATCH", `${clinic()}/subscription`, {
      expiresAt: "2020-01-01T00:00:00Z",
    });
    expect(past.json()).toMatchObject({ access: "expired" });
    expect(code(await get(h, "/v1/me", A.admin.cookie))).toBe("subscription_blocked");
    const both = await keyed({ durationDays: 5, expiresAt: "2099-01-01T00:00:00Z" }, randomUUID());
    expect(both.statusCode).toBe(400);
    expect((await platform("PATCH", `${clinic()}/subscription`, {})).statusCode).toBe(400);
    await platform("PATCH", `${clinic()}/subscription`, { expiresAt: "2099-01-01T00:00:00Z" });
    expect((await get(h, "/v1/me", A.admin.cookie)).statusCode).toBe(200);
  });
});

describe("durationDays is relative, so it needs an Idempotency-Key", () => {
  it("refuses durationDays without a key", async () => {
    const res = await platform("PATCH", `${clinic()}/subscription`, { durationDays: 30 });
    expect(res.statusCode).toBe(400);
  });

  it("a retry with the same key later keeps the first expiry and writes no second audit row", async () => {
    const clock = h.app.get<Clock>(CLOCK);
    const real = clock.now;
    const key = randomUUID();
    try {
      clock.now = () => new Date("2031-01-01T00:00:00Z");
      const first = await keyed({ durationDays: 10 }, key);
      expect(first.json()).toMatchObject({ expiresAt: "2031-01-11T00:00:00.000Z" });
      const auditsBefore = (await audits("clinic.subscription_changed")).length;
      clock.now = () => new Date("2031-01-05T00:00:00Z");
      const retry = await keyed({ durationDays: 10 }, key);
      expect(retry.json()).toMatchObject({ expiresAt: "2031-01-11T00:00:00.000Z" });
      expect((await audits("clinic.subscription_changed")).length).toBe(auditsBefore);
      const other = await keyed({ durationDays: 20 }, key);
      expect(other.statusCode).toBe(409);
      expect(code(other)).toBe("idempotency_conflict");
    } finally {
      clock.now = real;
      await platform("PATCH", `${clinic()}/subscription`, { expiresAt: "2099-01-01T00:00:00Z" });
    }
  });
});

describe("story 13 / 18: limits and usage", () => {
  it("reports usage, ignores deactivated members, and accepts a limit below usage", async () => {
    const [branches] =
      await h.owner`SELECT count(*)::int AS n FROM branches WHERE clinic_id = ${clinic()} AND is_active`;
    const detail = (await platform("GET", clinic())).json();
    expect(detail.usage).toEqual({
      users: { used: 2, max: 5 },
      branches: { used: branches!["n"], max: 3 },
    });
    await h.owner`UPDATE memberships SET status = 'deactivated' WHERE user_id = ${A.doctor.userId}`;
    expect((await platform("GET", clinic())).json().usage.users).toEqual({ used: 1, max: 5 });
    await h.owner`UPDATE memberships SET status = 'active' WHERE user_id = ${A.doctor.userId}`;

    const lowered = await platform("PATCH", `${clinic()}/limits`, { maxUsers: 1 });
    expect(lowered.statusCode).toBe(200);
    expect(lowered.json().usage.users).toEqual({ used: 2, max: 1 });
    // Existing members are untouched (PRD §4.9): only new creates are blocked (slices 6–7).
    expect((await get(h, "/v1/me", A.doctor.cookie)).statusCode).toBe(200);
    const [row] = await audits("clinic.limits_changed");
    expect(row!["details"]).toEqual({
      before: { maxUsers: 5, maxBranches: 3 },
      after: { maxUsers: 1, maxBranches: 3 },
    });
    // SUB-03 groundwork: the port slices 6–7 call refuses the next user with the usage.
    const db = h.app.get<Database>(DATABASE);
    const limits = new ReaderClinicLimits(
      new PgClinicReader(db),
      new PgSeatUsageReader(db),
      h.app.get<Clock>(CLOCK),
    );
    const check = await limits.canAddUser(clinic());
    expect(limitReachedDetails("users", check)).toEqual({ resource: "users", used: 2, max: 1 });
    expect((await limits.canAddBranch(clinic())).kind).toBe(
      Number(branches!["n"]) + 1 <= 3 ? "within" : "exceeded",
    );
    expect((await platform("PATCH", `${clinic()}/limits`, { maxUsers: 0 })).statusCode).toBe(400);
    expect((await platform("PATCH", `${clinic()}/limits`, {})).statusCode).toBe(400);
  });
});
