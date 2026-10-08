import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { meResponseSchema, roleSummarySchema } from "@eyadex/contracts/access";

import { closeHarness, openHarness, type Harness } from "../auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers, get } from "./access-fixtures.ts";
import { code } from "./branch-fixtures.ts";
import {
  createRole,
  names,
  patchRole,
  roleAction,
  roleAudit,
  roleRow,
  setPatientsModule,
} from "./role-fixtures.ts";
import { act, customRole, memberOn, setMaxUsers } from "./user-fixtures.ts";

// FLAG-02, story 51, the granting bound, AUD-01 and RBAC-03 for the role writes (ADR-0017).
let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;

const summary = roleSummarySchema.strict();

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await clinicWithMembers(h);
  await setMaxUsers(h, A.admin.clinicId, 50);
});

afterAll(async () => {
  await closeHarness(h);
});

describe("FLAG-02: a switched-off module's keys are kept as they are", () => {
  it("NEGATIVE: an update keeps the role's patients keys and drops requested ones", async () => {
    const id = await customRole(h, A.admin.clinicId, [
      "view:patients:branch",
      "create:patients:branch",
      "view:users:clinic",
    ]);
    await setPatientsModule(h, A.admin.clinicId, false);
    try {
      const res = await patchRole(h, A.admin.cookie, id, {
        ...names(),
        permissionKeys: ["view:branches:clinic", "view:patients:clinic"],
      });
      expect(res.statusCode).toBe(200);
      const saved = ["create:patients:branch", "view:branches:clinic", "view:patients:branch"];
      expect(summary.parse(res.json()).permissionKeys).toEqual(saved);
      expect((await roleRow(h, id)).keys).toEqual(saved);
    } finally {
      await setPatientsModule(h, A.admin.clinicId, true);
    }
  });
});

describe("story 51: a role with members cannot be deactivated", () => {
  it("NEGATIVE: role_in_use counts deactivated members too; the role stays active", async () => {
    const id = await customRole(h, A.admin.clinicId, ["view:users:clinic"]);
    const member = await memberOn(h, A.admin, id);
    const off = await act(h, A.admin.cookie, `/v1/users/${member.memberId}/deactivate`);
    expect(off.statusCode).toBe(200);
    const res = await roleAction(h, A.admin.cookie, id, "deactivate");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "role_in_use", details: { count: 1 } });
    expect((await roleRow(h, id)).is_active).toBe(true);
    const listed = (await get(h, "/v1/roles?limit=100", A.admin.cookie)).json() as {
      items: { id: string; memberCount: number; activeUserCount: number }[];
    };
    expect(listed.items.find((r) => r.id === id)).toMatchObject({
      memberCount: 1,
      activeUserCount: 0,
    });
  });
});

describe("granting bound on role writes (only keys the actor holds)", () => {
  let editor: Awaited<ReturnType<typeof memberOn>>;
  beforeAll(async () => {
    const keys = ["view:roles:clinic", "create:roles:clinic", "update:roles:clinic"];
    editor = await memberOn(h, A.admin, await customRole(h, A.admin.clinicId, keys));
  });

  it("NEGATIVE: create with a key the actor lacks is forbidden; with its own keys it passes", async () => {
    const lacking = await createRole(h, editor.cookie, {
      ...names(),
      permissionKeys: ["view:users:clinic"],
    });
    expect(lacking.statusCode).toBe(403);
    expect(code(lacking)).toBe("forbidden");
    const own = await createRole(h, editor.cookie, {
      ...names(),
      permissionKeys: ["view:roles:clinic"],
    });
    expect(own.statusCode).toBe(201);
  });

  it("the Clinic Admin may grant branch-scope keys it holds at clinic scope", async () => {
    const res = await createRole(h, A.admin.cookie, {
      ...names(),
      permissionKeys: ["view:patients:branch", "create:patients:branch"],
    });
    expect(res.statusCode).toBe(201);
  });

  it("NEGATIVE: update may keep a key the actor lacks, never add one", async () => {
    const id = await customRole(h, A.admin.clinicId, ["view:users:clinic"]);
    const keep = await patchRole(h, editor.cookie, id, {
      ...names(),
      permissionKeys: ["view:users:clinic", "view:roles:clinic"],
    });
    expect(keep.statusCode).toBe(200);
    const add = await patchRole(h, editor.cookie, id, {
      ...names(),
      permissionKeys: ["view:users:clinic", "view:branches:clinic"],
    });
    expect(add.statusCode).toBe(403);
    expect((await roleRow(h, id)).keys).toEqual(["view:roles:clinic", "view:users:clinic"]);
  });
});

describe("AUD-01: one allowlisted audit row per change", () => {
  it("created (after) and updated (before + after), names masked, keys sorted", async () => {
    const body = {
      nameAr: "دور تجريبي",
      nameEn: `Call +96512345678 tag-${randomUUID().slice(0, 8)}`,
      permissionKeys: ["view:users:clinic", "view:branches:clinic"],
    };
    const id = summary.parse((await createRole(h, A.admin.cookie, body)).json()).id;
    await patchRole(h, A.admin.cookie, id, { ...body, permissionKeys: ["view:users:clinic"] });
    const rows = await roleAudit(h, A.admin.clinicId, id);
    expect(rows.map((r) => r["action"])).toEqual(["role.created", "role.updated"]);
    expect(rows[0]).toMatchObject({ category: "administrative", actor_user_id: A.admin.userId });
    expect(Object.keys(rows[0]!["details"] as object)).toEqual(["after"]);
    const after = (rows[0]!["details"] as { after: Record<string, unknown> }).after;
    expect(Object.keys(after).sort()).toEqual(["isActive", "nameAr", "nameEn", "permissionKeys"]);
    expect(after["permissionKeys"]).toEqual(["view:branches:clinic", "view:users:clinic"]);
    expect(rows[1]!["details"]).toMatchObject({
      before: { permissionKeys: ["view:branches:clinic", "view:users:clinic"] },
      after: { permissionKeys: ["view:users:clinic"] },
    });
    const text = JSON.stringify(rows);
    expect(text).not.toContain("12345678");
    expect(text).toContain("***678");
  });
});

describe("RBAC-03: a role edit reaches its holders on the next request", () => {
  it("NEGATIVE: /v1/me shows the new keys right after the update, without signing in again", async () => {
    const id = await customRole(h, A.admin.clinicId, ["view:users:clinic"]);
    const member = await memberOn(h, A.admin, id);
    const me = async () =>
      meResponseSchema.parse((await get(h, "/v1/me", member.cookie)).json()).permissions;
    // Twice: the second read is served from the cache, so only an invalidation can change it.
    expect(await me()).toEqual(["view:users:clinic"]);
    expect(await me()).toEqual(["view:users:clinic"]);
    const res = await patchRole(h, A.admin.cookie, id, {
      ...names(),
      permissionKeys: ["view:users:clinic", "view:branches:clinic"],
    });
    expect(res.statusCode).toBe(200);
    expect(await me()).toEqual(["view:branches:clinic", "view:users:clinic"]);
    expect((await get(h, "/v1/branches", member.cookie)).statusCode).toBe(200);
  });
});
