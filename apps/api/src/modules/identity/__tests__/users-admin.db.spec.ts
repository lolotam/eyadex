import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { membershipUserViewSchema } from "@eyadex/contracts/users";
import { userListResponseSchema } from "@eyadex/contracts/user-admin";

import {
  APP,
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers, get, signedIn } from "./access-fixtures.ts";
import { branchAction, code, createBranch, patchBranch } from "./branch-fixtures.ts";
import { act, audit, customRole, memberOn, roleIdOf, setMaxUsers } from "./user-fixtures.ts";

let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;
let B: Awaited<ReturnType<typeof clinicWithMembers>>;
let adminRole: string;
let doctorRole: string;

const memberIdOf = async (userId: string) => {
  const [row] = await h.owner`SELECT id FROM memberships WHERE user_id = ${userId}`;
  return row!["id"] as string;
};

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await clinicWithMembers(h);
  B = await clinicWithMembers(h);
  adminRole = await roleIdOf(h, A.admin.clinicId, "clinic_admin");
  doctorRole = await roleIdOf(h, A.admin.clinicId, "doctor");
  await setMaxUsers(h, A.admin.clinicId, 50);
});

afterAll(async () => {
  await closeHarness(h);
});

describe("RBAC-01: every user endpoint", () => {
  const id = () => memberIdOf(A.doctor.userId);
  const calls = {
    list: async (c?: string, host?: string) => get(h, "/v1/users", c, host),
    role: async (c?: string, host?: string) =>
      act(h, c, `/v1/users/${await id()}/role`, { roleId: doctorRole }, "PATCH", host),
    branches: async (c?: string, host?: string) =>
      act(
        h,
        c,
        `/v1/users/${await id()}/branches`,
        { allBranches: true, branchIds: [] },
        "PATCH",
        host,
      ),
    deactivate: async (c?: string, host?: string) =>
      act(h, c, `/v1/users/${await id()}/deactivate`, undefined, "POST", host),
    reactivate: async (c?: string, host?: string) =>
      act(h, c, `/v1/users/${await id()}/reactivate`, undefined, "POST", host),
  };
  for (const [name, run] of Object.entries(calls)) {
    it(`${name}: 403 without the key, 401 without a session, 404 on the platform host`, async () => {
      const denied = await run(A.doctor.cookie);
      expect([denied.statusCode, code(denied)]).toEqual([403, "forbidden"]);
      expect((await run()).statusCode).toBe(401);
      expect((await run(A.admin.cookie, PLATFORM)).statusCode).toBe(404);
    });
  }

  it("a role with only view:users:clinic can list but is refused every user write", async () => {
    const viewer = await memberOn(
      h,
      A.admin,
      await customRole(h, A.admin.clinicId, ["view:users:clinic"]),
    );
    const id = await memberIdOf(A.doctor.userId);
    expect((await get(h, "/v1/users", viewer.cookie)).statusCode).toBe(200);
    for (const res of [
      await act(h, viewer.cookie, `/v1/users/${id}/role`, { roleId: doctorRole }, "PATCH"),
      await act(
        h,
        viewer.cookie,
        `/v1/users/${id}/branches`,
        { allBranches: true, branchIds: [] },
        "PATCH",
      ),
      await act(h, viewer.cookie, `/v1/users/${id}/deactivate`),
      await act(h, viewer.cookie, `/v1/users/${id}/reactivate`),
    ]) {
      expect([res.statusCode, code(res)]).toEqual([403, "forbidden"]);
    }
  });

  it("slice-6 gap: a role with only view:branches:clinic is refused every branch write", async () => {
    const viewer = await memberOn(
      h,
      A.admin,
      await customRole(h, A.admin.clinicId, ["view:branches:clinic"]),
    );
    const branch = A.doctor.branchId;
    expect((await get(h, "/v1/branches", viewer.cookie)).statusCode).toBe(200);
    for (const res of [
      await createBranch(h, viewer.cookie),
      await patchBranch(h, viewer.cookie, branch, { nameEn: "X" }),
      await branchAction(h, viewer.cookie, branch, "deactivate"),
      await branchAction(h, viewer.cookie, branch, "reactivate"),
    ]) {
      expect([res.statusCode, code(res)]).toEqual([403, "forbidden"]);
    }
  });
});

describe("role and branches (AUD-01, RBAC-03)", () => {
  it("changes the role, takes effect on the next request, one audit row each", async () => {
    const member = await memberOn(h, A.admin, doctorRole);
    expect((await get(h, "/v1/users", member.cookie)).statusCode).toBe(403);
    const res = await act(
      h,
      A.admin.cookie,
      `/v1/users/${member.memberId}/role`,
      { roleId: adminRole },
      "PATCH",
    );
    expect(res.statusCode).toBe(200);
    membershipUserViewSchema.strict().parse(res.json());
    expect((await get(h, "/v1/users", member.cookie)).statusCode).toBe(200);
    const same = await act(
      h,
      A.admin.cookie,
      `/v1/users/${member.memberId}/role`,
      { roleId: adminRole },
      "PATCH",
    );
    expect(same.statusCode).toBe(200);
    const rows = await audit(h, A.admin.clinicId, member.memberId);
    expect(rows.map((r) => r["action"]).filter((a) => a !== "invitation.accepted")).toEqual([
      "user.role_changed",
    ]);
    for (const r of rows) expect(String(r["raw"])).not.toMatch(/token|hash|phone|civil/i);
  });

  it("changes branches; another clinic's branch → 404; /v1/me sees the new scope", async () => {
    const member = await memberOn(h, A.admin, doctorRole);
    const url = `/v1/users/${member.memberId}/branches`;
    const foreign = await act(
      h,
      A.admin.cookie,
      url,
      { allBranches: false, branchIds: [B.doctor.branchId] },
      "PATCH",
    );
    expect(foreign.statusCode).toBe(404);
    const res = await act(
      h,
      A.admin.cookie,
      url,
      { allBranches: false, branchIds: [A.doctor.branchId] },
      "PATCH",
    );
    expect(res.json()).toMatchObject({ allBranches: false, branchIds: [A.doctor.branchId] });
    expect((await get(h, "/v1/me", member.cookie)).json().branchIds).toEqual([A.doctor.branchId]);
    expect(
      (await audit(h, A.admin.clinicId, member.memberId))
        .map((r) => r["action"])
        .filter((a) => String(a).startsWith("user.")),
    ).toEqual(["user.branches_changed"]);
  });
});

describe("ADM-01: the last active admin", () => {
  it("cannot be deactivated or demoted; with two admins one may go; parallel → exactly one", async () => {
    const C = await clinicWithMembers(h);
    await setMaxUsers(h, C.admin.clinicId, 50);
    const cAdminRole = await roleIdOf(h, C.admin.clinicId, "clinic_admin");
    const cDoctorRole = await roleIdOf(h, C.admin.clinicId, "doctor");
    const first = await memberIdOf(C.admin.userId);
    const lone = await act(h, C.admin.cookie, `/v1/users/${first}/deactivate`);
    expect([lone.statusCode, code(lone)]).toEqual([409, "last_active_admin"]);
    const demote = await act(
      h,
      C.admin.cookie,
      `/v1/users/${first}/role`,
      { roleId: cDoctorRole },
      "PATCH",
    );
    expect(code(demote)).toBe("last_active_admin");

    const others = [];
    for (let i = 0; i < 4; i += 1) others.push(await memberOn(h, C.admin, cAdminRole));
    const results = await Promise.all([
      act(h, C.admin.cookie, `/v1/users/${first}/deactivate`),
      ...others.map((o) => act(h, o.cookie, `/v1/users/${o.memberId}/deactivate`)),
    ]);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(4);
    expect(results.filter((r) => code(r) === "last_active_admin")).toHaveLength(1);
    const [row] = await h.owner`SELECT count(*)::int AS n FROM memberships m
      JOIN roles r ON r.clinic_id = m.clinic_id AND r.id = m.role_id
      WHERE m.clinic_id = ${C.admin.clinicId} AND m.status = 'active' AND r.system_key = 'clinic_admin'`;
    expect(row!["n"]).toBe(1);
  });
});

describe("deactivate / reactivate", () => {
  it("ends the member's sessions; reactivation restores sign-in", async () => {
    const member = await memberOn(h, A.admin, doctorRole);
    const res = await act(h, A.admin.cookie, `/v1/users/${member.memberId}/deactivate`);
    expect(res.json().status).toBe("deactivated");
    expect([401, 403]).toContain((await get(h, "/v1/me", member.cookie)).statusCode);
    expect(
      await h.owner`SELECT 1 FROM auth_sessions WHERE user_id = ${member.userId}`,
    ).toHaveLength(0);
    expect(
      (await act(h, A.admin.cookie, `/v1/users/${member.memberId}/deactivate`)).statusCode,
    ).toBe(200);
    expect(
      (await act(h, A.admin.cookie, `/v1/users/${member.memberId}/reactivate`)).statusCode,
    ).toBe(200);
    const again = await signedIn(h, A.admin.clinicId, member.email, member.password);
    expect((await get(h, "/v1/me", again.cookie)).statusCode).toBe(200);
    expect(
      (await audit(h, A.admin.clinicId, member.memberId))
        .map((r) => r["action"])
        .filter((a) => String(a).startsWith("user.")),
    ).toEqual(["user.deactivated", "user.reactivated"]);
  });

  it("SUB-03: a deactivated member frees a seat; reactivating at the limit → limit_reached", async () => {
    const member = await memberOn(h, A.admin, doctorRole);
    await act(h, A.admin.cookie, `/v1/users/${member.memberId}/deactivate`);
    const [row] = await h.owner`SELECT
      (SELECT count(*)::int FROM memberships WHERE clinic_id = ${A.admin.clinicId} AND status = 'active') +
      (SELECT count(*)::int FROM invitations WHERE clinic_id = ${A.admin.clinicId}
         AND status = 'pending' AND expires_at > now()) AS n`;
    const usedNow = Number(row!["n"]);
    await setMaxUsers(h, A.admin.clinicId, usedNow);
    const res = await act(h, A.admin.cookie, `/v1/users/${member.memberId}/reactivate`);
    expect([res.statusCode, code(res)]).toEqual([409, "limit_reached"]);
    expect(res.json().details).toEqual({ resource: "users", used: usedNow, max: usedNow });
    await setMaxUsers(h, A.admin.clinicId, 50);
  });
});

describe("ISO-02 and the list", () => {
  it("clinic A cannot change clinic B's member (404) and never lists it", async () => {
    const theirs = await memberIdOf(B.doctor.userId);
    for (const [url, body, method] of [
      [`/v1/users/${theirs}/role`, { roleId: doctorRole }, "PATCH"],
      [`/v1/users/${theirs}/branches`, { allBranches: true, branchIds: [] }, "PATCH"],
      [`/v1/users/${theirs}/deactivate`, undefined, "POST"],
      [`/v1/users/${theirs}/reactivate`, undefined, "POST"],
    ] as const) {
      const res = await act(h, A.admin.cookie, url, body, method);
      expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
    }
    const list = userListResponseSchema.parse(
      (await get(h, "/v1/users?limit=100", A.admin.cookie)).json(),
    );
    list.items.forEach((item) => membershipUserViewSchema.strict().parse(item));
    expect(list.items.every((u) => u.clinicId === A.admin.clinicId)).toBe(true);
  });

  it("filters by branch (all-branches members included) and status", async () => {
    const res = await get(
      h,
      `/v1/users?branchId=${A.doctor.branchId}&status=active`,
      A.admin.cookie,
    );
    const page = userListResponseSchema.parse(res.json());
    const ids = page.items.map((u) => u.userId);
    expect(ids).toContain(A.doctor.userId);
    expect(ids).toContain(A.admin.userId);
    expect(page.total).toBe(page.items.length);
  });
});

describe("stranded members (ADR-0012)", () => {
  it("409 with the count and names, then 200 with confirmation and strandedMemberCount audited", async () => {
    const C = await clinicWithMembers(h);
    await createBranch(h, C.admin.cookie, undefined, undefined, APP);
    const branch = C.doctor.branchId;
    const list = (await get(h, "/v1/branches", C.admin.cookie)).json().items as {
      id: string;
      exclusiveMemberCount: number;
    }[];
    expect(list.find((b) => b.id === branch)?.exclusiveMemberCount).toBe(1);
    const refused = await branchAction(h, C.admin.cookie, branch, "deactivate");
    expect([refused.statusCode, code(refused)]).toEqual([409, "branch_has_exclusive_members"]);
    expect(refused.json().details).toEqual({
      count: 1,
      members: [{ id: await memberIdOf(C.doctor.userId), fullName: "Branch Doctor" }],
    });
    const ok = await branchAction(h, C.admin.cookie, branch, "deactivate", APP, {
      confirmStrandedMembers: true,
    });
    expect(ok.statusCode).toBe(200);
    const [row] = await audit(h, C.admin.clinicId, branch);
    expect((row!["details"] as { strandedMemberCount: number }).strandedMemberCount).toBe(1);
  });
});
