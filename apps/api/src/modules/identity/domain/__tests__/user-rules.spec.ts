import { describe, expect, it } from "vitest";

import {
  decideInvitationCancel,
  decideInvitationResend,
  decideMemberDeactivation,
  decideRoleChange,
  mayTouchAdminRole,
  personAuditSnapshot,
  reachesABranch,
  sameBranchSet,
} from "../user-rules.ts";

const admin = { status: "active" as const, roleSystemKey: "clinic_admin" };
const doctor = { status: "active" as const, roleSystemKey: "doctor" };

describe("ADM-01 rules", () => {
  it("the last active admin cannot be deactivated; another admin can", () => {
    expect(decideMemberDeactivation(admin, 1)).toBe("last_active_admin");
    expect(decideMemberDeactivation(admin, 2)).toBe("allowed");
    expect(decideMemberDeactivation(doctor, 1)).toBe("allowed");
    expect(decideMemberDeactivation({ ...admin, status: "deactivated" }, 1)).toBe(
      "already_inactive",
    );
  });

  it("the last active admin cannot be moved off the admin role", () => {
    expect(decideRoleChange(admin, "r1", { id: "r2", systemKey: "doctor" }, 1)).toBe(
      "last_active_admin",
    );
    expect(decideRoleChange(admin, "r1", { id: "r2", systemKey: null }, 2)).toBe("allowed");
    expect(decideRoleChange(admin, "r1", { id: "r1", systemKey: "clinic_admin" }, 1)).toBe("same");
    expect(decideRoleChange(doctor, "r1", { id: "r2", systemKey: "clinic_admin" }, 1)).toBe(
      "allowed",
    );
  });
});

describe("admin-role guard (ADR-0012 §15)", () => {
  it("only an admin may grant, change or act on the admin role", () => {
    expect(mayTouchAdminRole(false, ["clinic_admin"])).toBe(false);
    expect(mayTouchAdminRole(false, ["doctor", "clinic_admin"])).toBe(false);
    expect(mayTouchAdminRole(true, ["clinic_admin"])).toBe(true);
    expect(mayTouchAdminRole(false, ["doctor", null])).toBe(true);
  });
});

describe("reactivation reach (ADR-0012 §16)", () => {
  it("an all-branches member always reaches one; otherwise one active branch is needed", () => {
    expect(reachesABranch(true, 0)).toBe(true);
    expect(reachesABranch(false, 1)).toBe(true);
    expect(reachesABranch(false, 0)).toBe(false);
  });
});

describe("invitation rules", () => {
  const now = new Date("2026-10-07T00:00:00Z");
  it("resend: pending only; an expired one re-occupies a seat", () => {
    expect(decideInvitationResend("pending", new Date("2026-10-06T00:00:00Z"), now)).toBe(
      "reoccupies_seat",
    );
    expect(decideInvitationResend("pending", now, now)).toBe("reoccupies_seat");
    expect(decideInvitationResend("pending", new Date("2026-10-08T00:00:00Z"), now)).toBe(
      "keeps_seat",
    );
    expect(decideInvitationResend("accepted", now, now)).toBe("not_pending");
    expect(decideInvitationResend("cancelled", now, now)).toBe("not_pending");
  });
  it("cancel: a cancelled one is a no-op, an accepted one is refused", () => {
    expect(decideInvitationCancel("pending")).toBe("allowed");
    expect(decideInvitationCancel("cancelled")).toBe("already_cancelled");
    expect(decideInvitationCancel("accepted")).toBe("accepted");
  });
});

describe("helpers", () => {
  it("compares branch sets without order", () => {
    expect(sameBranchSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameBranchSet(["a"], ["a", "b"])).toBe(false);
  });
  it("the audit snapshot keeps only the allowlist", () => {
    const snapshot = personAuditSnapshot({
      fullName: "N",
      email: "e@example.test",
      roleId: "r",
      roleNameAr: "ط",
      roleNameEn: "D",
      allBranches: false,
      branchIds: ["b", "a"],
      status: "active",
      ...({ tokenHash: "x", token: "y", phone: "z" } as object),
    });
    expect(Object.keys(snapshot)).not.toContain("tokenHash");
    expect(Object.keys(snapshot)).not.toContain("token");
    expect(snapshot.branchIds).toEqual(["a", "b"]);
  });
});
