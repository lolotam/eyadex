import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeHarness, openHarness, type Harness } from "../auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "./access-fixtures.ts";
import { code } from "./branch-fixtures.ts";
import { roleAction, roleRow } from "./role-fixtures.ts";
import { act, customRole, invite, inviteBody, memberOn, setMaxUsers } from "./user-fixtures.ts";

// The granting bound (ADR-0017): every path that puts someone on a role — role reactivation, change
// role, invite, resend / copy link, member reactivation — may only grant keys the actor holds.
let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;
/** Stronger than every non-admin actor below: it adds update:users and view:branches. */
let strong: string;
/** Within every actor's keys. */
let weak: string;

const STRONG = ["view:users:clinic", "update:users:clinic", "view:branches:clinic"];
const memberRole = async (memberId: string) =>
  (await h.owner`SELECT role_id FROM memberships WHERE id = ${memberId}`)[0]!["role_id"];

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await clinicWithMembers(h);
  await setMaxUsers(h, A.admin.clinicId, 50);
  strong = await customRole(h, A.admin.clinicId, STRONG);
  weak = await customRole(h, A.admin.clinicId, ["view:users:clinic"]);
});

afterAll(async () => {
  await closeHarness(h);
});

describe("role reactivation, then self-assignment", () => {
  it("NEGATIVE: reactivating an inactive role stronger than the actor is forbidden", async () => {
    const keys = ["view:roles:clinic", "deactivate:roles:clinic", "view:users:clinic"];
    const actor = await memberOn(h, A.admin, await customRole(h, A.admin.clinicId, keys));
    const dormant = await customRole(h, A.admin.clinicId, STRONG);
    await h.owner`UPDATE roles SET is_active = false WHERE id = ${dormant}`;
    const res = await roleAction(h, actor.cookie, dormant, "reactivate");
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe("forbidden");
    expect((await roleRow(h, dormant)).is_active).toBe(false);
  });

  it("NEGATIVE: assigning a stronger role to oneself is forbidden", async () => {
    const keys = ["view:users:clinic", "update:users:clinic"];
    const actor = await memberOn(h, A.admin, await customRole(h, A.admin.clinicId, keys));
    const before = await memberRole(actor.memberId);
    const res = await act(
      h,
      actor.cookie,
      `/v1/users/${actor.memberId}/role`,
      {
        roleId: strong,
      },
      "PATCH",
    );
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe("forbidden");
    expect(await memberRole(actor.memberId)).toBe(before);
  });
});

describe("change role and member reactivation", () => {
  it("NEGATIVE: change role to a stronger role is forbidden; a role within the actor's keys passes", async () => {
    const keys = ["view:users:clinic", "update:users:clinic"];
    const actor = await memberOn(h, A.admin, await customRole(h, A.admin.clinicId, keys));
    const target = await memberOn(h, A.admin, weak);
    const path = `/v1/users/${target.memberId}/role`;
    const refused = await act(h, actor.cookie, path, { roleId: strong }, "PATCH");
    expect([refused.statusCode, code(refused)]).toEqual([403, "forbidden"]);
    expect(await memberRole(target.memberId)).toBe(weak);
    const within = await customRole(h, A.admin.clinicId, keys);
    expect((await act(h, actor.cookie, path, { roleId: within }, "PATCH")).statusCode).toBe(200);
  });

  it("NEGATIVE: reactivating a member whose role is stronger than the actor is forbidden", async () => {
    const keys = ["view:users:clinic", "deactivate:users:clinic"];
    const actor = await memberOn(h, A.admin, await customRole(h, A.admin.clinicId, keys));
    const target = await memberOn(h, A.admin, strong);
    expect(
      (await act(h, A.admin.cookie, `/v1/users/${target.memberId}/deactivate`)).statusCode,
    ).toBe(200);
    const res = await act(h, actor.cookie, `/v1/users/${target.memberId}/reactivate`);
    expect([res.statusCode, code(res)]).toEqual([403, "forbidden"]);
  });
});

describe("invitations", () => {
  let inviter: Awaited<ReturnType<typeof memberOn>>;
  beforeAll(async () => {
    const keys = ["view:users:clinic", "create:users:clinic"];
    inviter = await memberOn(h, A.admin, await customRole(h, A.admin.clinicId, keys));
  });

  it("NEGATIVE: invite with a stronger role is forbidden; a role within the actor's keys passes", async () => {
    const refused = await invite(h, inviter.cookie, inviteBody(strong));
    expect([refused.statusCode, code(refused)]).toEqual([403, "forbidden"]);
    expect((await invite(h, inviter.cookie, inviteBody(weak))).statusCode).toBe(201);
  });

  it("NEGATIVE: resend and copy link of an invitation on a stronger role are forbidden", async () => {
    const sent = await invite(h, A.admin.cookie, inviteBody(strong));
    expect(sent.statusCode).toBe(201);
    const id = (sent.json() as { id: string }).id;
    for (const action of ["resend", "link"]) {
      const res = await act(h, inviter.cookie, `/v1/invitations/${id}/${action}`);
      expect([action, res.statusCode, code(res)]).toEqual([action, 403, "forbidden"]);
    }
  });
});

describe("the Clinic Admin is unaffected", () => {
  it("reactivates, assigns and invites with any role", async () => {
    const dormant = await customRole(h, A.admin.clinicId, STRONG);
    await h.owner`UPDATE roles SET is_active = false WHERE id = ${dormant}`;
    expect((await roleAction(h, A.admin.cookie, dormant, "reactivate")).statusCode).toBe(200);
    const target = await memberOn(h, A.admin, weak);
    const path = `/v1/users/${target.memberId}/role`;
    expect((await act(h, A.admin.cookie, path, { roleId: dormant }, "PATCH")).statusCode).toBe(200);
    const sent = await invite(h, A.admin.cookie, inviteBody(dormant));
    expect(sent.statusCode).toBe(201);
    const id = (sent.json() as { id: string }).id;
    expect((await act(h, A.admin.cookie, `/v1/invitations/${id}/link`)).statusCode).toBe(200);
  });
});
