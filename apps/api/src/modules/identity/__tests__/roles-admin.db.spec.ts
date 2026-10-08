import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { roleSummarySchema } from "@eyadex/contracts/access";

import {
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "./access-fixtures.ts";
import { code } from "./branch-fixtures.ts";
import { createRole, names, patchRole, roleAction, roleAudit, roleRow } from "./role-fixtures.ts";
import { customRole, memberOn, roleIdOf, setMaxUsers } from "./user-fixtures.ts";

// RBAC-01, ISO-02, story 52, unique names and idempotency for the role writes (ADR-0017).
let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;
let B: Awaited<ReturnType<typeof clinicWithMembers>>;
let viewer: Awaited<ReturnType<typeof memberOn>>;

const summary = roleSummarySchema.strict();

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await clinicWithMembers(h);
  B = await clinicWithMembers(h);
  await setMaxUsers(h, A.admin.clinicId, 50);
  // Holds view:roles but no write key: a refusal below is the write guard's, not the read's.
  viewer = await memberOn(h, A.admin, await customRole(h, A.admin.clinicId, ["view:roles:clinic"]));
});

afterAll(async () => {
  await closeHarness(h);
});

describe("RBAC-01: every role write", () => {
  let target: string;
  beforeAll(async () => {
    target = await customRole(h, A.admin.clinicId, []);
  });
  const calls = {
    create: (cookie?: string, host?: string) => createRole(h, cookie, undefined, undefined, host),
    update: (cookie?: string, host?: string) =>
      patchRole(h, cookie, target, { ...names(), permissionKeys: [] }, host),
    deactivate: (cookie?: string, host?: string) =>
      roleAction(h, cookie, target, "deactivate", host),
    reactivate: (cookie?: string, host?: string) =>
      roleAction(h, cookie, target, "reactivate", host),
  };

  for (const [name, run] of Object.entries(calls)) {
    it(`NEGATIVE ${name}: a role without the write key gets 403`, async () => {
      const res = await run(viewer.cookie);
      expect(res.statusCode).toBe(403);
      expect(code(res)).toBe("forbidden");
    });
    it(`${name}: no session gets 401`, async () => {
      expect((await run()).statusCode).toBe(401);
    });
    it(`${name}: the platform host gets 404`, async () => {
      expect((await run(A.admin.cookie, PLATFORM)).statusCode).toBe(404);
    });
  }
});

describe("happy paths", () => {
  it("creates a custom role: 201, the list shape, sorted keys, no system key", async () => {
    const body = {
      ...names("Nurse"),
      permissionKeys: ["view:users:clinic", "view:branches:clinic"],
    };
    const res = await createRole(h, A.admin.cookie, body);
    expect(res.statusCode).toBe(201);
    const role = summary.parse(res.json());
    expect(role).toMatchObject({
      nameEn: body.nameEn,
      systemKey: null,
      isLocked: false,
      isActive: true,
      memberCount: 0,
      activeUserCount: 0,
      permissionKeys: ["view:branches:clinic", "view:users:clinic"],
    });
    expect((await roleRow(h, role.id)).keys).toEqual(role.permissionKeys);
  });

  it("updates names and keys, deactivates and reactivates a free role", async () => {
    const id = summary.parse((await createRole(h, A.admin.cookie)).json()).id;
    const next = { ...names("Renamed"), permissionKeys: ["view:roles:clinic"] };
    const updated = await patchRole(h, A.admin.cookie, id, next);
    expect(updated.statusCode).toBe(200);
    expect(summary.parse(updated.json())).toMatchObject({
      nameEn: next.nameEn,
      permissionKeys: ["view:roles:clinic"],
    });
    const off = await roleAction(h, A.admin.cookie, id, "deactivate");
    expect(off.statusCode).toBe(200);
    expect(summary.parse(off.json()).isActive).toBe(false);
    const on = await roleAction(h, A.admin.cookie, id, "reactivate");
    expect(summary.parse(on.json()).isActive).toBe(true);
    const actions = (await roleAudit(h, A.admin.clinicId, id)).map((r) => r["action"]);
    expect(actions).toEqual([
      "role.created",
      "role.updated",
      "role.deactivated",
      "role.reactivated",
    ]);
  });

  it("a no-op (same names, same keys in another order) writes nothing", async () => {
    const body = { ...names(), permissionKeys: ["view:users:clinic", "view:roles:clinic"] };
    const id = summary.parse((await createRole(h, A.admin.cookie, body)).json()).id;
    const same = { ...body, permissionKeys: ["view:roles:clinic", "view:users:clinic"] };
    expect((await patchRole(h, A.admin.cookie, id, same)).statusCode).toBe(200);
    expect((await roleAction(h, A.admin.cookie, id, "reactivate")).statusCode).toBe(200);
    expect(await roleAudit(h, A.admin.clinicId, id)).toHaveLength(1);
  });

  it("a ready role that is not locked (doctor) is editable (PRD §4.7, story 45)", async () => {
    const doctor = await roleIdOf(h, A.admin.clinicId, "doctor");
    const before = await roleRow(h, doctor);
    const res = await patchRole(h, A.admin.cookie, doctor, {
      nameAr: before.name_ar,
      nameEn: before.name_en,
      permissionKeys: [...before.keys, "view:branches:clinic"],
    });
    expect(res.statusCode).toBe(200);
    expect(summary.parse(res.json()).permissionKeys).toContain("view:branches:clinic");
  });
});

describe("story 52: the locked Clinic Admin role refuses every write", () => {
  it("NEGATIVE: update, deactivate and reactivate answer role_locked; nothing changes", async () => {
    const admin = await roleIdOf(h, A.admin.clinicId, "clinic_admin");
    const before = await roleRow(h, admin);
    const rename = await patchRole(h, A.admin.cookie, admin, {
      ...names(),
      permissionKeys: before.keys,
    });
    expect(rename.statusCode).toBe(409);
    expect(code(rename)).toBe("role_locked");
    const off = await roleAction(h, A.admin.cookie, admin, "deactivate");
    expect(off.statusCode).toBe(409);
    expect(code(off)).toBe("role_locked");
    expect(await roleRow(h, admin)).toEqual(before);
    expect(await roleAudit(h, A.admin.clinicId, admin)).toHaveLength(0);
  });

  it("NEGATIVE: reactivating the locked role answers role_locked, not a no-op", async () => {
    const admin = await roleIdOf(h, B.admin.clinicId, "clinic_admin");
    const res = await roleAction(h, B.admin.cookie, admin, "reactivate");
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe("role_locked");
  });
});

describe("ISO-02: clinic A never reaches clinic B's roles", () => {
  it("NEGATIVE: update, deactivate and reactivate of B's role answer 404; the row is unchanged", async () => {
    const theirs = await customRole(h, B.admin.clinicId, ["view:users:clinic"]);
    const before = await roleRow(h, theirs);
    const body = { ...names(), permissionKeys: [] };
    expect((await patchRole(h, A.admin.cookie, theirs, body)).statusCode).toBe(404);
    expect((await roleAction(h, A.admin.cookie, theirs, "deactivate")).statusCode).toBe(404);
    expect((await roleAction(h, A.admin.cookie, theirs, "reactivate")).statusCode).toBe(404);
    expect(await roleRow(h, theirs)).toEqual(before);
  });

  it("a malformed id is 404, like an unknown one", async () => {
    expect((await roleAction(h, A.admin.cookie, "nope", "deactivate")).statusCode).toBe(404);
    expect((await roleAction(h, A.admin.cookie, randomUUID(), "deactivate")).statusCode).toBe(404);
  });
});

describe("unique names (0018)", () => {
  it("NEGATIVE: a duplicate name, ignoring case and spaces, is role_name_taken on create", async () => {
    const taken = names("Dup");
    await createRole(h, A.admin.cookie, { ...taken, permissionKeys: [] });
    const res = await createRole(h, A.admin.cookie, {
      nameAr: "اسم آخر",
      nameEn: `  ${taken.nameEn.toUpperCase()} `,
      permissionKeys: [],
    });
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe("role_name_taken");
  });

  it("NEGATIVE: renaming onto another role's name is role_name_taken; the same name in B is free", async () => {
    const taken = names("Twin");
    await createRole(h, A.admin.cookie, { ...taken, permissionKeys: [] });
    const id = summary.parse((await createRole(h, A.admin.cookie)).json()).id;
    const res = await patchRole(h, A.admin.cookie, id, { ...taken, permissionKeys: [] });
    expect(code(res)).toBe("role_name_taken");
    expect((await createRole(h, B.admin.cookie, { ...taken, permissionKeys: [] })).statusCode).toBe(
      201,
    );
  });
});

describe("idempotent create", () => {
  it("same key + same body (keys in another order) → the same role, one row, one audit row", async () => {
    const key = randomUUID();
    const body = { ...names(), permissionKeys: ["view:users:clinic", "view:roles:clinic"] };
    const one = await createRole(h, A.admin.cookie, body, key);
    const reordered = { ...body, permissionKeys: ["view:roles:clinic", "view:users:clinic"] };
    const two = await createRole(h, A.admin.cookie, reordered, key);
    expect(one.statusCode).toBe(201);
    expect(two.statusCode).toBe(201);
    expect(two.json().id).toBe(one.json().id);
    expect(await h.owner`SELECT id FROM roles WHERE name_en = ${body.nameEn}`).toHaveLength(1);
    expect(await roleAudit(h, A.admin.clinicId, one.json().id)).toHaveLength(1);
  });

  it("NEGATIVE: same key + another body → idempotency_conflict, no second role", async () => {
    const key = randomUUID();
    const first = names("First");
    await createRole(h, A.admin.cookie, { ...first, permissionKeys: [] }, key);
    const second = names("Second");
    const res = await createRole(h, A.admin.cookie, { ...second, permissionKeys: [] }, key);
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe("idempotency_conflict");
    expect(await h.owner`SELECT id FROM roles WHERE name_en = ${second.nameEn}`).toHaveLength(0);
  });

  it("requires the header", async () => {
    expect(code(await createRole(h, A.admin.cookie, undefined, ""))).toBe("validation");
  });
});

describe("catalogue only (story 47)", () => {
  const bad = [
    ["an unknown key", ["delete:everything:clinic"]],
    ["two scopes for one action", ["view:patients:clinic", "view:patients:branch"]],
    ["a write without its view", ["create:users:clinic"]],
  ] as const;
  it.each(bad)("NEGATIVE: %s is a validation error", async (_label, permissionKeys) => {
    const res = await createRole(h, A.admin.cookie, { ...names(), permissionKeys });
    expect(res.statusCode).toBe(400);
    expect(code(res)).toBe("validation");
  });

  it("rejects unknown fields and a missing name", async () => {
    const extra = { ...names(), permissionKeys: [], isLocked: true };
    expect(code(await createRole(h, A.admin.cookie, extra))).toBe("validation");
    const id = await customRole(h, A.admin.clinicId, []);
    expect(code(await patchRole(h, A.admin.cookie, id, { nameEn: "Only" }))).toBe("validation");
  });
});
