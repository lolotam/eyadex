import { describe, expect, it } from "vitest";

import { SYSTEM_ROLES } from "../system-roles.ts";
import {
  decideRoleDefinition,
  decideRoleGrant,
  reachWithin,
  uncoveredKeys,
  type BranchReach,
  type GrantingMember,
} from "../grant-rules.ts";

const ALL: BranchReach = { allBranches: true, branchIds: [] };
const branchA: BranchReach = { allBranches: false, branchIds: ["a"] };
const member = (keys: string[], reach = ALL, active = true): GrantingMember => ({
  active,
  keys,
  reach,
});
const adminKeys = [...SYSTEM_ROLES.find((r) => r.key === "clinic_admin")!.permissions];

describe("uncoveredKeys (stored keys, every module)", () => {
  it("a clinic-scope key covers the same action at branch scope, never the reverse", () => {
    expect(uncoveredKeys(["create:patients:clinic"], ["create:patients:branch"])).toEqual([]);
    expect(uncoveredKeys(["create:patients:branch"], ["create:patients:clinic"])).toEqual([
      "create:patients:clinic",
    ]);
  });

  it("counts a key of a switched-off module: it comes back when the module does", () => {
    // Flipped from a2ace7d, where module-filtered keys let a hidden patients key through.
    expect(uncoveredKeys(["view:users:clinic"], ["view:patients:branch"])).toEqual([
      "view:patients:branch",
    ]);
  });
});

describe("reachWithin (data-scope containment)", () => {
  it("an all-branch target needs an all-branch actor", () => {
    expect(reachWithin(ALL, ALL)).toBe(true);
    expect(reachWithin(ALL, branchA)).toBe(false);
  });

  it("a branch target must sit inside the actor's branches", () => {
    expect(reachWithin(branchA, branchA)).toBe(true);
    expect(reachWithin({ allBranches: false, branchIds: ["a", "b"] }, branchA)).toBe(false);
    expect(reachWithin(branchA, ALL)).toBe(true);
  });
});

describe("decideRoleDefinition (create, update, deactivate, reactivate)", () => {
  it("needs an active, all-branch actor whose stored keys cover the role", () => {
    const keys = ["view:roles:clinic", "view:users:clinic"];
    expect(decideRoleDefinition(member(keys), ["view:users:clinic"])).toBe("allowed");
    expect(decideRoleDefinition(member(keys), ["view:branches:clinic"])).toBe("forbidden");
    expect(decideRoleDefinition(member(keys, branchA), [])).toBe("forbidden");
    expect(decideRoleDefinition(member(keys, ALL, false), [])).toBe("forbidden");
    expect(decideRoleDefinition(null, [])).toBe("forbidden");
  });

  it("the Clinic Admin covers every catalogue key, branch scopes included", () => {
    const every = ["view:patients:branch", "deactivate:patients:branch", "view:audit_log:clinic"];
    expect(decideRoleDefinition(member(adminKeys), every)).toBe("allowed");
  });
});

describe("decideRoleGrant (change role, branches, invite, resend, link, member reactivation)", () => {
  const keys = ["view:users:clinic", "update:users:clinic"];

  it("needs covering keys and a target scope inside the actor's", () => {
    expect(decideRoleGrant(member(keys), ["view:users:clinic"], ALL)).toBe("allowed");
    expect(decideRoleGrant(member(keys), ["view:branches:clinic"], ALL)).toBe("forbidden");
    expect(decideRoleGrant(member(keys, branchA), ["view:users:clinic"], ALL)).toBe("forbidden");
    expect(decideRoleGrant(member(keys, branchA), ["view:users:clinic"], branchA)).toBe("allowed");
    expect(decideRoleGrant(member(keys, ALL, false), [], ALL)).toBe("forbidden");
  });

  it("a hidden module key of the role is still a key to cover", () => {
    expect(decideRoleGrant(member(keys), ["view:patients:branch"], ALL)).toBe("forbidden");
  });

  it("the Clinic Admin grants any role anywhere", () => {
    expect(decideRoleGrant(member(adminKeys), ["view:patients:branch"], branchA)).toBe("allowed");
  });
});
