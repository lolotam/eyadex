import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { meResponseSchema } from "@eyadex/contracts/access";

import { closeHarness, openHarness, type Harness } from "../auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers, get } from "./access-fixtures.ts";
import { code } from "./branch-fixtures.ts";
import {
  createRole,
  names,
  patchRole,
  roleAction,
  roleRow,
  setPatientsModule,
} from "./role-fixtures.ts";
import { act, customRole, invite, inviteBody, memberOn, setMaxUsers } from "./user-fixtures.ts";

// The delegation model (ADR-0017 §6), decided on the actor as the database holds it under the
// `roles:` lock: stored keys of every module, branch scope, and no stale request context.
let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;
let branchA: string;

const scopedTo = (branchId: string) => ({ allBranches: false, branchIds: [branchId] });

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await clinicWithMembers(h);
  await setMaxUsers(h, A.admin.clinicId, 50);
  branchA = A.doctor.branchId;
});

afterAll(async () => {
  await closeHarness(h);
});

describe("a switched-off module's keys still count", () => {
  it("NEGATIVE: module off → self-assign a role with a hidden patients key → module on: no access gained", async () => {
    const keys = ["view:users:clinic", "update:users:clinic"];
    const actor = await memberOn(h, A.admin, await customRole(h, A.admin.clinicId, keys));
    const hidden = await customRole(h, A.admin.clinicId, [...keys, "view:patients:branch"]);
    await setPatientsModule(h, A.admin.clinicId, false);
    let res;
    try {
      res = await act(
        h,
        actor.cookie,
        `/v1/users/${actor.memberId}/role`,
        { roleId: hidden },
        "PATCH",
      );
    } finally {
      await setPatientsModule(h, A.admin.clinicId, true);
    }
    expect([res.statusCode, code(res)]).toEqual([403, "forbidden"]);
    const me = meResponseSchema.parse((await get(h, "/v1/me", actor.cookie)).json());
    expect(me.permissions).not.toContain("view:patients:branch");
  });
});

describe("a branch-scoped editor", () => {
  let editor: Awaited<ReturnType<typeof memberOn>>;
  beforeAll(async () => {
    const keys = [
      "view:roles:clinic",
      "create:roles:clinic",
      "update:roles:clinic",
      "deactivate:roles:clinic",
      "view:patients:branch",
    ];
    const role = await customRole(h, A.admin.clinicId, keys);
    editor = await memberOn(h, A.admin, role, scopedTo(branchA));
  });

  it("NEGATIVE: cannot add a branch key to a role an all-branch member holds", async () => {
    const target = await customRole(h, A.admin.clinicId, ["view:roles:clinic"]);
    await memberOn(h, A.admin, target);
    const res = await patchRole(h, editor.cookie, target, {
      ...names(),
      permissionKeys: ["view:roles:clinic", "view:patients:branch"],
    });
    expect([res.statusCode, code(res)]).toEqual([403, "forbidden"]);
    expect((await roleRow(h, target)).keys).toEqual(["view:roles:clinic"]);
  });

  it("NEGATIVE: cannot do any role definition write at all", async () => {
    const free = await customRole(h, A.admin.clinicId, []);
    const dormant = await customRole(h, A.admin.clinicId, []);
    await h.owner`UPDATE roles SET is_active = false WHERE id = ${dormant}`;
    const answers = [
      await createRole(h, editor.cookie, { ...names(), permissionKeys: [] }),
      await patchRole(h, editor.cookie, free, { ...names(), permissionKeys: [] }),
      await roleAction(h, editor.cookie, free, "deactivate"),
      await roleAction(h, editor.cookie, dormant, "reactivate"),
    ];
    expect(answers.map((r) => [r.statusCode, code(r)])).toEqual(Array(4).fill([403, "forbidden"]));
  });
});

describe("data-scope containment on grants", () => {
  it("NEGATIVE: a branch-scoped grantor cannot give a role to an all-branch member or invitee", async () => {
    const keys = ["view:users:clinic", "update:users:clinic", "create:users:clinic"];
    const grantor = await memberOn(
      h,
      A.admin,
      await customRole(h, A.admin.clinicId, keys),
      scopedTo(branchA),
    );
    const weak = await customRole(h, A.admin.clinicId, ["view:users:clinic"]);
    const wide = await memberOn(h, A.admin, await customRole(h, A.admin.clinicId, []));
    const moved = await act(
      h,
      grantor.cookie,
      `/v1/users/${wide.memberId}/role`,
      { roleId: weak },
      "PATCH",
    );
    expect([moved.statusCode, code(moved)]).toEqual([403, "forbidden"]);
    const everywhere = await invite(h, grantor.cookie, inviteBody(weak));
    expect([everywhere.statusCode, code(everywhere)]).toEqual([403, "forbidden"]);
    expect((await invite(h, grantor.cookie, inviteBody(weak, scopedTo(branchA)))).statusCode).toBe(
      201,
    );
  });
});

describe("revocation race", () => {
  it("NEGATIVE: a PATCH queued behind a committed revocation is decided on the revoked keys", async () => {
    const keys = ["view:roles:clinic", "update:roles:clinic", "view:branches:clinic"];
    const editorRole = await customRole(h, A.admin.clinicId, keys);
    const editor = await memberOn(h, A.admin, editorRole);
    const target = await customRole(h, A.admin.clinicId, ["view:roles:clinic"]);
    expect((await get(h, "/v1/roles", editor.cookie)).statusCode).toBe(200); // warm the cache
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));
    const revocation = h.owner.begin(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`roles:${A.admin.clinicId}`}, 0))`;
      await sql`DELETE FROM role_permissions rp USING permissions p
                WHERE rp.role_id = ${editorRole} AND p.id = rp.permission_id
                  AND p.key = 'view:branches:clinic'`;
      locked();
      await gate;
    });
    await holding;
    const patch = patchRole(h, editor.cookie, target, {
      ...names(),
      permissionKeys: ["view:roles:clinic", "view:branches:clinic"],
    });
    let blocked = false;
    for (let i = 0; i < 100 && !blocked; i += 1) {
      const [row] = await h.owner`SELECT count(*)::int AS n FROM pg_locks
                                  WHERE locktype = 'advisory' AND NOT granted`;
      blocked = row!["n"] !== 0;
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    release();
    await revocation;
    const res = await patch;
    expect(blocked).toBe(true);
    expect([res.statusCode, code(res)]).toEqual([403, "forbidden"]);
    expect((await roleRow(h, target)).keys).toEqual(["view:roles:clinic"]);
  });
});

describe("the Clinic Admin passes everything", () => {
  it("defines, grants and scopes any role", async () => {
    const strong = ["view:users:clinic", "view:patients:branch", "create:patients:branch"];
    const made = await createRole(h, A.admin.cookie, { ...names(), permissionKeys: strong });
    expect(made.statusCode).toBe(201);
    const id = (made.json() as { id: string }).id;
    const updated = await patchRole(h, A.admin.cookie, id, {
      ...names(),
      permissionKeys: [...strong, "view:branches:clinic"],
    });
    expect(updated.statusCode).toBe(200);
    expect((await roleAction(h, A.admin.cookie, id, "deactivate")).statusCode).toBe(200);
    expect((await roleAction(h, A.admin.cookie, id, "reactivate")).statusCode).toBe(200);
    const target = await memberOn(h, A.admin, await customRole(h, A.admin.clinicId, []));
    const moved = await act(
      h,
      A.admin.cookie,
      `/v1/users/${target.memberId}/role`,
      { roleId: id },
      "PATCH",
    );
    expect(moved.statusCode).toBe(200);
    const branches = await act(
      h,
      A.admin.cookie,
      `/v1/users/${target.memberId}/branches`,
      scopedTo(branchA),
      "PATCH",
    );
    expect(branches.statusCode).toBe(200);
    const sent = await invite(h, A.admin.cookie, inviteBody(id, scopedTo(branchA)));
    expect(sent.statusCode).toBe(201);
    const link = await act(
      h,
      A.admin.cookie,
      `/v1/invitations/${(sent.json() as { id: string }).id}/link`,
    );
    expect(link.statusCode).toBe(200);
  });
});
