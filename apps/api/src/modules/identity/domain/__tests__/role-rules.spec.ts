import { describe, expect, it } from "vitest";

import { permissionKeysSchema } from "@eyadex/contracts/roles";

import {
  decideRoleDeactivation,
  decideRoleReactivation,
  decideRoleUpdate,
  hiddenScopeGap,
  isEditableKey,
  mergeHiddenKeys,
  roleAuditSnapshot,
  sameKeySet,
  sameRole,
} from "../role-rules.ts";
import { SYSTEM_ROLES } from "../system-roles.ts";

const custom = { isLocked: false, isActive: true };
const locked = { isLocked: true, isActive: true };

describe("hidden module keys (PRD §4.8, FLAG-02)", () => {
  it("a core key is always editable; a module key only while its module is on", () => {
    expect(isEditableKey("view:roles:clinic", [])).toBe(true);
    expect(isEditableKey("view:patients:branch", [])).toBe(false);
    expect(isEditableKey("view:patients:branch", ["patients"])).toBe(true);
    expect(isEditableKey("delete:everything:clinic", ["patients"])).toBe(false);
  });

  it("keeps the role's existing keys of a switched-off module whatever the input says", () => {
    const existing = ["view:patients:branch", "create:patients:branch", "view:users:clinic"];
    const saved = mergeHiddenKeys(["view:branches:clinic"], existing, []);
    expect(saved).toEqual([
      "create:patients:branch",
      "view:branches:clinic",
      "view:patients:branch",
    ]);
  });

  it("drops a requested key of a switched-off module, like the mock", () => {
    expect(mergeHiddenKeys(["view:patients:clinic", "view:users:clinic"], [], [])).toEqual([
      "view:users:clinic",
    ]);
  });

  it("with the module on, the request decides every key", () => {
    const saved = mergeHiddenKeys(["view:users:clinic"], ["view:patients:branch"], ["patients"]);
    expect(saved).toEqual(["view:users:clinic"]);
  });
});

describe("write decisions (stories 51–52)", () => {
  it("the locked role refuses update, deactivate and reactivate", () => {
    expect(decideRoleUpdate(locked)).toBe("locked");
    expect(decideRoleDeactivation(locked, 0)).toBe("locked");
    expect(decideRoleReactivation({ ...locked, isActive: false })).toBe("locked");
    expect(decideRoleUpdate(custom)).toBe("allowed");
  });

  it("a role with members in any status cannot be deactivated", () => {
    expect(decideRoleDeactivation(custom, 1)).toBe("in_use");
    expect(decideRoleDeactivation(custom, 0)).toBe("allowed");
    expect(decideRoleDeactivation({ ...custom, isActive: false }, 3)).toBe("already_inactive");
  });

  it("reactivation of an active role is a no-op", () => {
    expect(decideRoleReactivation(custom)).toBe("already_active");
    expect(decideRoleReactivation({ ...custom, isActive: false })).toBe("allowed");
  });
});

describe("no-op and audit", () => {
  const role = { nameAr: "ممرضة", nameEn: "Nurse", permissionKeys: ["b", "a"] };

  it("the same names and the same key set, in any order, change nothing", () => {
    expect(sameKeySet(["a", "b", "a"], ["b", "a"])).toBe(true);
    expect(sameKeySet(["a"], ["a", "b"])).toBe(false);
    expect(sameRole(role, { ...role, permissionKeys: ["a", "b"] })).toBe(true);
    expect(sameRole(role, { ...role, nameEn: "Nurses" })).toBe(false);
  });

  it("the snapshot keeps the allowlist only, keys sorted", () => {
    const snapshot = roleAuditSnapshot({
      ...role,
      isActive: true,
      ...({ id: "x", systemKey: "doctor" } as object),
    });
    expect(snapshot).toEqual({
      nameAr: "ممرضة",
      nameEn: "Nurse",
      isActive: true,
      permissionKeys: ["a", "b"],
    });
  });
});

// PR #98 review: the saved set, kept hidden keys included, is checked after mergeHiddenKeys.
describe("the view-scope gap of the saved keys", () => {
  it("names the module of a kept write wider than its view", () => {
    const kept = mergeHiddenKeys(
      ["view:users:clinic"],
      ["view:payments:branch", "create:payments:clinic"],
      [],
    );
    expect(hiddenScopeGap(kept)).toBe("finance");
  });

  it("is null when every write is covered", () => {
    expect(hiddenScopeGap(["view:payments:clinic", "create:payments:clinic"])).toBeNull();
    expect(hiddenScopeGap([])).toBeNull();
  });
});

// Issue #93: new clinics are seeded from these templates, so each must pass the role contract as is.
describe("the system role templates", () => {
  it.each(SYSTEM_ROLES.map((r) => [r.key, r.permissions] as const))(
    "%s passes the role contract, the view-scope rule included",
    (_key, permissions) => {
      expect(permissionKeysSchema.safeParse([...permissions]).success).toBe(true);
    },
  );
});
