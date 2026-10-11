import { describe, expect, it } from "vitest";

import { grantFor } from "../permission-check.ts";
import { SYSTEM_ROLES } from "../system-roles.ts";
import {
  decideRoleDefinition,
  decideRoleGrant,
  uncoveredKeys,
  type BranchReach,
  type GrantingMember,
} from "../grant-rules.ts";

// P2 spec §2, R1-2, R1-3: who may hand out the medical module's keys.
const ALL: BranchReach = { allBranches: true, branchIds: [] };
const C = "create:roles:clinic";
const U = "update:users:clinic";
const adminKeys = [...SYSTEM_ROLES.find((r) => r.key === "clinic_admin")!.permissions];
const lockedAdmin: GrantingMember = { active: true, keys: adminKeys, reach: ALL, lockedRole: true };
const doctorKeys = [
  "view:visits:own",
  "create:visits:own",
  "view:medical:own",
  "update:medical:own",
  "view:medicines:clinic",
];

describe("the locked clinic admin delegates the visits and medical keys (R1-2)", () => {
  it("defines and grants a doctor role holding none of those keys itself", () => {
    expect(adminKeys.some((k) => k.includes(":medical:") || k.includes(":visits:"))).toBe(false);
    expect(decideRoleDefinition(lockedAdmin, C, ["view:medical:own"])).toBe("allowed");
    expect(decideRoleGrant(lockedAdmin, U, ["view:medical:own", "create:visits:own"], ALL)).toBe(
      "allowed",
    );
  });

  it("NEGATIVE: the delegation stops at visits and medical; medicines keys still need holding", () => {
    expect(uncoveredKeys([], ["update:medicines:clinic"], true)).toEqual([
      "update:medicines:clinic",
    ]);
    expect(uncoveredKeys([], ["view:patients:branch"], true)).toEqual(["view:patients:branch"]);
  });

  it("NEGATIVE: the same keys on an unlocked role delegate nothing", () => {
    const unlocked = { ...lockedAdmin, lockedRole: false };
    expect(decideRoleDefinition(unlocked, C, ["view:medical:own"])).toBe("forbidden");
  });
});

describe("nobody else grants a key it lacks (R1-2, R1-3)", () => {
  const doctor: GrantingMember = {
    active: true,
    keys: [...doctorKeys, C, U, "view:roles:clinic", "view:users:clinic"],
    reach: ALL,
    lockedRole: false,
  };

  it("NEGATIVE: a doctor holding view:medical:own cannot grant it to another role", () => {
    expect(decideRoleDefinition(doctor, C, ["view:medical:own"])).toBe("forbidden");
    expect(decideRoleGrant(doctor, U, ["view:medical:own"], ALL)).toBe("forbidden");
  });

  it("the own keys are clinic-bound: only their clinic key covers them", () => {
    for (const [own, clinic] of [
      ["view:visits:own", "view:visits:clinic"],
      ["view:medical:own", "view:medical:clinic"],
      ["update:medical:own", "update:medical:clinic"],
    ] as const) {
      expect(uncoveredKeys([clinic], [own])).toEqual([]);
      expect(uncoveredKeys([own], [own])).toEqual([own]);
    }
    expect(uncoveredKeys(["view:visits:branch"], ["view:visits:own"])).toEqual(["view:visits:own"]);
  });

  it("the route guard is unchanged: the front desk's branch key still reaches an own route", () => {
    expect(grantFor(["view:visits:branch"], "view:visits:own")).toBe("branch");
  });
});
