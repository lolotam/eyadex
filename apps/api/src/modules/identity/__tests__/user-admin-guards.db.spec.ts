import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  APP,
  closeHarness,
  openHarness,
  type Harness,
} from "../auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "./access-fixtures.ts";
import { branchAction, code, createBranch, setMaxBranches } from "./branch-fixtures.ts";
import {
  act,
  audit,
  customRole,
  invite,
  inviteBody,
  memberOn,
  roleIdOf,
  setMaxUsers,
} from "./user-fixtures.ts";

// Review round of slice 7 (ADR-0012 §15–§16): the admin-role guard, reactivation reach, resend
// re-validation, no-ops before validation, the resend email fallback and masked 409 details; round 2:
// the stranded-members count of an inactive branch and masked role names in audit snapshots.

let h: Harness;
let C: Awaited<ReturnType<typeof clinicWithMembers>>;
let doctorRole: string;

const memberIdOf = async (userId: string) => {
  const [row] = await h.owner`SELECT id FROM memberships WHERE user_id = ${userId}`;
  return row!["id"] as string;
};
const newBranch = async () => {
  const res = await createBranch(h, C.admin.cookie);
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
};
const invited = async (body: Record<string, unknown>) => {
  const res = await invite(h, C.admin.cookie, body);
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
};

beforeAll(async () => {
  h = await openHarness({}, true);
  C = await clinicWithMembers(h);
  doctorRole = await roleIdOf(h, C.admin.clinicId, "doctor");
  await setMaxUsers(h, C.admin.clinicId, 50);
  await setMaxBranches(h, C.admin.clinicId, 50);
});

afterAll(async () => {
  await closeHarness(h);
});

describe("only an admin touches the admin role", () => {
  it("a user manager cannot promote, invite or act on an admin; an admin can", async () => {
    // Its own clinic: on the old code the manager deactivates this admin, which must not leak.
    const D = await clinicWithMembers(h);
    await setMaxUsers(h, D.admin.clinicId, 50);
    const [dAdminRole, dDoctorRole] = [
      await roleIdOf(h, D.admin.clinicId, "clinic_admin"),
      await roleIdOf(h, D.admin.clinicId, "doctor"),
    ];
    // view:patients:branch too: moving the doctor's branches grants the doctor role there, which the
    // granting bound (ADR-0017 §6) lets only an actor holding its keys do.
    const managerRole = await customRole(h, D.admin.clinicId, [
      "view:users:clinic",
      "create:users:clinic",
      "update:users:clinic",
      "deactivate:users:clinic",
      "view:patients:branch",
    ]);
    const manager = await memberOn(h, D.admin, managerRole);
    const adminMember = await memberIdOf(D.admin.userId);
    const refused = [
      await act(
        h,
        manager.cookie,
        `/v1/users/${manager.memberId}/role`,
        { roleId: dAdminRole },
        "PATCH",
      ),
      await invite(h, manager.cookie, inviteBody(dAdminRole)),
      await act(h, manager.cookie, `/v1/users/${adminMember}/deactivate`),
      await act(
        h,
        manager.cookie,
        `/v1/users/${adminMember}/role`,
        { roleId: dDoctorRole },
        "PATCH",
      ),
    ];
    expect(refused.map((r) => [r.statusCode, code(r)])).toEqual(Array(4).fill([403, "forbidden"]));
    const doctorMember = await memberIdOf(D.doctor.userId);
    const allowed = await act(
      h,
      manager.cookie,
      `/v1/users/${doctorMember}/branches`,
      { allBranches: true, branchIds: [] },
      "PATCH",
    );
    expect(allowed.statusCode).toBe(200);
    const promoted = await act(
      h,
      D.admin.cookie,
      `/v1/users/${manager.memberId}/role`,
      { roleId: dAdminRole },
      "PATCH",
    );
    expect(promoted.statusCode).toBe(200);
  });
});

describe("reactivation never strands a member", () => {
  it("refuses a member whose only branch was deactivated meanwhile, until the branches change", async () => {
    await newBranch();
    const only = await newBranch();
    const member = await memberOn(h, C.admin, doctorRole, {
      allBranches: false,
      branchIds: [only],
    });
    expect(
      (await act(h, C.admin.cookie, `/v1/users/${member.memberId}/deactivate`)).statusCode,
    ).toBe(200);
    expect((await branchAction(h, C.admin.cookie, only, "deactivate")).statusCode).toBe(200);
    const refused = await act(h, C.admin.cookie, `/v1/users/${member.memberId}/reactivate`);
    expect([refused.statusCode, code(refused)]).toEqual([400, "branch_inactive"]);
    const moved = await act(
      h,
      C.admin.cookie,
      `/v1/users/${member.memberId}/branches`,
      { allBranches: true, branchIds: [] },
      "PATCH",
    );
    expect(moved.statusCode).toBe(200);
    expect(
      (await act(h, C.admin.cookie, `/v1/users/${member.memberId}/reactivate`)).statusCode,
    ).toBe(200);
  });
});

describe("no-ops before validation", () => {
  it("re-sending the current branches answers 200 and writes nothing, even with one now inactive", async () => {
    const [x, y] = [await newBranch(), await newBranch()];
    const member = await memberOn(h, C.admin, doctorRole, {
      allBranches: false,
      branchIds: [x, y],
    });
    expect((await branchAction(h, C.admin.cookie, x, "deactivate")).statusCode).toBe(200);
    const rowsBefore = (await audit(h, C.admin.clinicId, member.memberId)).length;
    const same = await act(
      h,
      C.admin.cookie,
      `/v1/users/${member.memberId}/branches`,
      { allBranches: false, branchIds: [y, x] },
      "PATCH",
    );
    expect(same.statusCode).toBe(200);
    expect(await audit(h, C.admin.clinicId, member.memberId)).toHaveLength(rowsBefore);
  });
});

describe("resend", () => {
  it("re-checks the invitation's branches: a link to an inactive branch is not re-sent", async () => {
    const branch = await newBranch();
    const id = await invited(inviteBody(doctorRole, { allBranches: false, branchIds: [branch] }));
    expect((await branchAction(h, C.admin.cookie, branch, "deactivate")).statusCode).toBe(200);
    const refused = await act(h, C.admin.cookie, `/v1/invitations/${id}/resend`);
    expect([refused.statusCode, code(refused)]).toEqual([400, "branch_inactive"]);
  });

  it("reserves a free email again when the expired hold was taken over and released", async () => {
    const body = inviteBody(doctorRole);
    const stale = await invited(body);
    await h.owner`UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE id = ${stale}`;
    await h.owner`UPDATE email_reservations SET expires_at = now() - interval '1 minute'
                  WHERE invitation_id = ${stale}`;
    const other = await invited({ ...body });
    expect((await act(h, C.admin.cookie, `/v1/invitations/${other}/cancel`)).statusCode).toBe(200);
    const resent = await act(h, C.admin.cookie, `/v1/invitations/${stale}/resend`);
    expect(resent.statusCode).toBe(200);
  });
});

describe("stranded-members details", () => {
  it("mask a phone number typed into a member's name", async () => {
    await newBranch();
    const only = await newBranch();
    await memberOn(h, C.admin, doctorRole, {
      fullName: "Nurse +96512345678",
      allBranches: false,
      branchIds: [only],
    });
    const refused = await branchAction(h, C.admin.cookie, only, "deactivate");
    expect([refused.statusCode, code(refused)]).toEqual([409, "branch_has_exclusive_members"]);
    expect(refused.body).not.toContain("12345678");
  });

  it("count 0 once the deactivation is confirmed: the branch is nobody's active branch", async () => {
    await newBranch();
    const only = await newBranch();
    await memberOn(h, C.admin, doctorRole, { allBranches: false, branchIds: [only] });
    const confirmed = await branchAction(h, C.admin.cookie, only, "deactivate", APP, {
      confirmStrandedMembers: true,
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ isActive: false, exclusiveMemberCount: 0 });
  });
});

describe("audit snapshots", () => {
  it("mask a phone number typed into a custom role's names, for a role change and an invitation", async () => {
    const role = await customRole(h, C.admin.clinicId, []);
    await h.owner`UPDATE roles SET name_ar = 'استقبال +96512345678', name_en = 'Desk +96512345678'
                  WHERE id = ${role}`;
    const member = await memberOn(h, C.admin, doctorRole);
    const changed = await act(
      h,
      C.admin.cookie,
      `/v1/users/${member.memberId}/role`,
      { roleId: role },
      "PATCH",
    );
    expect(changed.statusCode).toBe(200);
    const invitationId = await invited(inviteBody(role));
    const rows = [
      ...(await audit(h, C.admin.clinicId, member.memberId)),
      ...(await audit(h, C.admin.clinicId, invitationId)),
    ];
    expect(rows.map((r) => r["action"])).toEqual(
      expect.arrayContaining(["user.role_changed", "invitation.sent"]),
    );
    expect(rows.map((r) => r["raw"] as string).join()).not.toContain("12345678");
  });
});
