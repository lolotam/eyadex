import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";
import { describe, expect, it } from "vitest";

import { grantFor } from "../permission-check.ts";
import { SYSTEM_ROLES } from "../system-roles.ts";
import {
  decideActorPermission,
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

describe("decideActorPermission (the route's own key, reloaded after the locks)", () => {
  it("refuses an actor whose stored keys no longer hold the route's permission", () => {
    expect(decideActorPermission(member(["create:roles:clinic"]), "create:roles:clinic")).toBe(
      "allowed",
    );
    expect(decideActorPermission(member(["view:roles:clinic"]), "create:roles:clinic")).toBe(
      "forbidden",
    );
    expect(
      decideActorPermission(member(["create:roles:clinic"], ALL, false), "create:roles:clinic"),
    ).toBe("forbidden");
    expect(decideActorPermission(null, "create:roles:clinic")).toBe("forbidden");
  });

  it("a clinic key covers a branch requirement", () => {
    expect(decideActorPermission(member(["view:patients:clinic"]), "view:patients:branch")).toBe(
      "allowed",
    );
  });
});

describe("decideRoleDefinition (create, update, deactivate, reactivate)", () => {
  const C = "create:roles:clinic";

  it("needs the route key, an active all-branch actor, and stored keys covering the role", () => {
    const keys = [C, "view:roles:clinic", "view:users:clinic"];
    expect(decideRoleDefinition(member(keys), C, ["view:users:clinic"])).toBe("allowed");
    expect(decideRoleDefinition(member(keys), C, ["view:branches:clinic"])).toBe("forbidden");
    expect(decideRoleDefinition(member(keys, branchA), C, [])).toBe("forbidden");
    expect(decideRoleDefinition(member(keys, ALL, false), C, [])).toBe("forbidden");
    expect(decideRoleDefinition(null, C, [])).toBe("forbidden");
  });

  it("refuses an empty role once the route key is gone (Codex round 3)", () => {
    expect(decideRoleDefinition(member(["view:roles:clinic"]), C, [])).toBe("forbidden");
  });

  it("the Clinic Admin covers every catalogue key, branch scopes included", () => {
    const every = ["view:patients:branch", "deactivate:patients:branch", "view:audit_log:clinic"];
    expect(decideRoleDefinition(member(adminKeys), C, every)).toBe("allowed");
  });
});

describe("decideRoleGrant (change role, branches, invite, resend, link, member reactivation)", () => {
  const U = "update:users:clinic";
  const keys = ["view:users:clinic", U];

  it("needs the route key, covering keys and a target scope inside the actor's", () => {
    expect(decideRoleGrant(member(keys), U, ["view:users:clinic"], ALL)).toBe("allowed");
    expect(decideRoleGrant(member(keys), U, ["view:branches:clinic"], ALL)).toBe("forbidden");
    expect(decideRoleGrant(member(keys, branchA), U, ["view:users:clinic"], ALL)).toBe("forbidden");
    expect(decideRoleGrant(member(keys, branchA), U, ["view:users:clinic"], branchA)).toBe(
      "allowed",
    );
    expect(decideRoleGrant(member(keys, ALL, false), U, [], ALL)).toBe("forbidden");
    expect(decideRoleGrant(member(["view:users:clinic"]), U, [], ALL)).toBe("forbidden");
  });

  it("a hidden module key of the role is still a key to cover", () => {
    expect(decideRoleGrant(member(keys), U, ["view:patients:branch"], ALL)).toBe("forbidden");
  });

  it("the Clinic Admin grants any role anywhere", () => {
    expect(decideRoleGrant(member(adminKeys), U, ["view:patients:branch"], branchA)).toBe(
      "allowed",
    );
  });
});

describe("the own scope (spec §3: the narrowest; a wider scope on the same action wins)", () => {
  it("own is granted by own, branch or clinic, and grants nothing wider", () => {
    expect(grantFor(["view:appointments:own"], "view:appointments:own")).toBe("own");
    expect(grantFor(["view:appointments:branch"], "view:appointments:own")).toBe("branch");
    expect(grantFor(["view:appointments:clinic"], "view:appointments:own")).toBe("clinic");
    expect(grantFor(["view:appointments:own"], "view:appointments:branch")).toBeNull();
    expect(grantFor(["view:appointments:own"], "view:appointments:clinic")).toBeNull();
  });

  it("a branch-scope actor covers an own key when defining or granting a role", () => {
    expect(uncoveredKeys(["view:appointments:branch"], ["view:appointments:own"])).toEqual([]);
    expect(uncoveredKeys(["view:appointments:own"], ["view:appointments:branch"])).toEqual([
      "view:appointments:branch",
    ]);
  });
});

describe("new-clinic system roles (ADR-0026 §6)", () => {
  it("the locked admin holds every clinic-scope key of the catalogue, appointments included", () => {
    const clinicKeys = PERMISSION_CATALOG.filter((p) => p.scope === "clinic").map((p) => p.key);
    expect([...adminKeys].sort()).toEqual([...clinicKeys].sort());
    expect(adminKeys).toContain("update:schedules:clinic");
  });
});

// Codex A3 r1: view:patients:own reaches files by their appointments in any branch, so a branch key
// would let a branch manager grant files of every branch. Only view:patients:clinic covers it.
describe("granting view:patients:own (ADR-0026 §12)", () => {
  it("only the clinic key covers it; a branch key or the own key itself does not", () => {
    const own = ["view:patients:own"];
    expect(uncoveredKeys(["view:patients:clinic"], own)).toEqual([]);
    expect(uncoveredKeys(["view:patients:branch"], own)).toEqual(own);
    expect(uncoveredKeys(["view:patients:own"], own)).toEqual(own);
    expect(uncoveredKeys(["view:appointments:branch"], ["view:appointments:own"])).toEqual([]);
  });
});
