import { randomUUID } from "node:crypto";

import { ModulesContainer } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLOCK, type Clock } from "../../tenancy/index.ts";
import { registeredRoutes } from "../access/route-access-check.ts";
import {
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../auth/__tests__/auth-http-harness.ts";
import {
  AUTHORIZATION_INVALIDATOR,
  type AuthorizationInvalidator,
} from "../ports/authorization-invalidator.ts";
import { clinicWithMembers, get, type Member } from "./access-fixtures.ts";

// RBAC-01, RBAC-03, RBAC-04, SUB-01, SUB-02 and ISO-02 groundwork over HTTP (ADR-0009).
let h: Harness;
let invalidate: AuthorizationInvalidator;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;
let B: Awaited<ReturnType<typeof clinicWithMembers>>;

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  A = await clinicWithMembers(h);
  B = await clinicWithMembers(h);
});

afterAll(async () => {
  await closeHarness(h);
});

const ENDPOINTS = ["/v1/me", "/v1/roles", "/v1/permissions/catalogue"];
const code = (res: { json: () => unknown }) => (res.json() as { code?: string }).code;

describe("RBAC-04: one access declaration per route", () => {
  it("every registered route declares exactly one rule", () => {
    const routes = registeredRoutes(h.app.get(ModulesContainer));
    for (const route of routes) expect(route.rules, route.route).toHaveLength(1);
    expect(routes.map((r) => r.route)).toEqual(
      expect.arrayContaining([
        "GET /v1/health",
        "GET /v1/me",
        "GET /v1/roles",
        "GET /v1/permissions/catalogue",
        "POST /v1/platform/clinics",
      ]),
    );
  });
});

describe("RBAC-01: the three read endpoints", () => {
  it("the admin reads all three", async () => {
    const me = await get(h, "/v1/me", A.admin.cookie);
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { id: A.admin.userId, email: A.admin.email },
      clinic: { id: A.admin.clinicId, nameEn: "Acceptance Clinic", timezone: "Asia/Kuwait" },
      role: { nameEn: "Clinic Admin" },
      allBranches: true,
    });
    expect(me.json().permissions).toContain("view:roles:clinic");
    expect((await get(h, "/v1/roles", A.admin.cookie)).statusCode).toBe(200);
    const catalogue = await get(h, "/v1/permissions/catalogue", A.admin.cookie);
    expect(catalogue.json().modules.map((m: { module: unknown }) => m.module)).toEqual([
      null,
      "patients",
    ]);
  });

  it("NEGATIVE: a role without view:roles:clinic gets 403 forbidden; /me still works", async () => {
    // Another member's branch row in the same clinic must not leak into the doctor's scope.
    const extra = randomUUID();
    await h.owner`INSERT INTO branches VALUES (${A.admin.clinicId}, ${extra}, 'ف', 'B2', true, now(), now())`;
    await h.owner`INSERT INTO membership_branches
      SELECT clinic_id, ${randomUUID()}, id, ${extra}, now() FROM memberships WHERE user_id = ${A.admin.userId}`;
    await invalidate.clinicChanged(A.admin.clinicId);
    for (const url of ["/v1/roles", "/v1/permissions/catalogue"]) {
      const res = await get(h, url, A.doctor.cookie);
      expect(res.statusCode, url).toBe(403);
      expect(code(res), url).toBe("forbidden");
    }
    const me = await get(h, "/v1/me", A.doctor.cookie);
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ allBranches: false, branchIds: [A.doctor.branchId] });
    expect(me.json().permissions).toEqual(["view:patients:branch"]);
  });

  it("NEGATIVE: no session → 401, platform host → 404", async () => {
    for (const url of ENDPOINTS) {
      const anonymous = await get(h, url);
      expect(anonymous.statusCode, url).toBe(401);
      expect(code(anonymous), url).toBe("unauthorized");
      const platform = await get(h, url, A.admin.cookie, PLATFORM);
      expect(platform.statusCode, url).toBe(404);
    }
  });
});

describe("RBAC-03: changes apply on the next request, without re-login", () => {
  it("granting view:roles:clinic to the doctor role opens /v1/roles", async () => {
    expect((await get(h, "/v1/roles", A.doctor.cookie)).statusCode).toBe(403);
    await h.owner`INSERT INTO role_permissions
      SELECT ${A.doctor.clinicId}, ${randomUUID()}, ${A.doctor.roleId}, id, now()
      FROM permissions WHERE key = 'view:roles:clinic'`;
    await invalidate.clinicChanged(A.doctor.clinicId);
    expect((await get(h, "/v1/roles", A.doctor.cookie)).statusCode).toBe(200);
    await h.owner`DELETE FROM role_permissions rp USING permissions p
      WHERE rp.permission_id = p.id AND p.key = 'view:roles:clinic'
        AND rp.clinic_id = ${A.doctor.clinicId} AND rp.role_id = ${A.doctor.roleId}`;
    await invalidate.clinicChanged(A.doctor.clinicId);
    expect((await get(h, "/v1/roles", A.doctor.cookie)).statusCode).toBe(403);
  });
});

async function blockedThenRestored(
  member: Member,
  change: () => Promise<void>,
  undo: () => Promise<void>,
) {
  expect((await get(h, "/v1/me", member.cookie)).statusCode).toBe(200);
  await change();
  const res = await get(h, "/v1/me", member.cookie);
  await undo();
  return res;
}

describe("SUB-01 / SUB-02 and deactivation", () => {
  it("NEGATIVE: a suspended clinic rejects an existing session on the next request", async () => {
    const res = await blockedThenRestored(
      B.admin,
      async () => {
        await h.owner`UPDATE clinics SET status = 'suspended' WHERE id = ${B.admin.clinicId}`;
        await invalidate.clinicChanged(B.admin.clinicId);
      },
      async () => {
        await h.owner`UPDATE clinics SET status = 'trial' WHERE id = ${B.admin.clinicId}`;
        await invalidate.clinicChanged(B.admin.clinicId);
      },
    );
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: "subscription_blocked",
      details: { reason: "suspended" },
    });
  });

  it("NEGATIVE: expiry passed on the injected clock → rejected, no job, no invalidation", async () => {
    const clock = h.app.get<Clock>(CLOCK);
    const real = clock.now;
    const res = await blockedThenRestored(
      B.admin,
      async () => {
        clock.now = () => new Date("2099-01-01T00:00:00Z");
      },
      async () => {
        clock.now = real;
      },
    );
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: "subscription_blocked",
      details: { reason: "expired" },
    });
  });

  it("NEGATIVE: a deactivated membership is rejected on the next request", async () => {
    const res = await blockedThenRestored(
      B.doctor,
      async () => {
        await h.owner`UPDATE memberships SET status = 'deactivated' WHERE user_id = ${B.doctor.userId}`;
        await invalidate.clinicChanged(B.doctor.clinicId);
      },
      async () => {
        await h.owner`UPDATE memberships SET status = 'active' WHERE user_id = ${B.doctor.userId}`;
        await invalidate.clinicChanged(B.doctor.clinicId);
      },
    );
    expect(res.statusCode).toBe(401);
    expect(code(res)).toBe("account_disabled");
  });
});

describe("ISO-02 groundwork: clinics never mix", () => {
  it("NEGATIVE: /v1/roles of A lists A's roles only", async () => {
    const res = await get(h, "/v1/roles?limit=100", A.admin.cookie);
    const ids = (res.json().items as { id: string }[]).map((r) => r.id);
    const rows = await h.owner`SELECT id, clinic_id FROM roles WHERE id = ANY(${ids})`;
    expect(rows.every((r) => r["clinic_id"] === A.admin.clinicId)).toBe(true);
    expect(ids).toHaveLength(4);
    expect(res.json().total).toBe(4);
    const admin = (
      res.json().items as { systemKey: string; activeUserCount: number; isLocked: boolean }[]
    ).find((r) => r.systemKey === "clinic_admin");
    expect(admin).toMatchObject({ activeUserCount: 1, isLocked: true });
  });

  it("NEGATIVE: the active-user count leaves deactivated members out", async () => {
    await h.owner`UPDATE memberships SET status = 'deactivated' WHERE user_id = ${B.doctor.userId}`;
    try {
      const res = await get(h, "/v1/roles?limit=100", B.admin.cookie);
      const doctor = (res.json().items as { id: string; activeUserCount: number }[]).find(
        (r) => r.id === B.doctor.roleId,
      );
      expect(doctor?.activeUserCount).toBe(0);
    } finally {
      await h.owner`UPDATE memberships SET status = 'active' WHERE user_id = ${B.doctor.userId}`;
      await invalidate.clinicChanged(B.doctor.clinicId);
    }
  });

  it("paginates with an opaque cursor and no overlap", async () => {
    const first = (await get(h, "/v1/roles?limit=3", A.admin.cookie)).json();
    expect(first.items).toHaveLength(3);
    const second = (
      await get(h, `/v1/roles?limit=3&cursor=${first.nextCursor}`, A.admin.cookie)
    ).json();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((r: { id: string }) => r.id);
    expect(new Set(all).size).toBe(4);
  });
});
