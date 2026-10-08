import { describe, expect, it } from "vitest";

import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";

import {
  decideRoleDeactivation,
  decideRoleReactivation,
  decideRoleUpdate,
  isEditableKey,
  keysBeyondActor,
  mergeHiddenKeys,
  roleAuditSnapshot,
  sameKeySet,
  sameRole,
} from "../role-rules.ts";

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

describe("granting bound (ADR-0017): one rule for every path that grants a role", () => {
  const ON = ["patients"] as const;

  it("returns the granted keys the actor does not hold", () => {
    expect(
      keysBeyondActor(["view:patients:clinic", "view:users:clinic"], [], ["view:users:clinic"], ON),
    ).toEqual(["view:patients:clinic"]);
  });

  it("a clinic-scope key covers the same action at branch scope, never the reverse", () => {
    expect(keysBeyondActor(["create:patients:branch"], [], ["create:patients:clinic"], ON)).toEqual(
      [],
    );
    expect(keysBeyondActor(["create:patients:clinic"], [], ["create:patients:branch"], ON)).toEqual(
      ["create:patients:clinic"],
    );
  });

  it("keys already granted are not re-checked: keeping or removing them is free", () => {
    expect(keysBeyondActor(["view:patients:clinic"], ["view:patients:clinic"], [], ON)).toEqual([]);
    expect(keysBeyondActor([], ["view:patients:clinic"], [], ON)).toEqual([]);
  });

  it("granting a whole role (assign, invite, reactivate) checks every effective key", () => {
    const role = ["view:users:clinic", "update:users:clinic"];
    expect(keysBeyondActor(role, [], ["view:users:clinic"], ON)).toEqual(["update:users:clinic"]);
    expect(keysBeyondActor(role, [], role, ON)).toEqual([]);
  });

  it("a key of a switched-off module has no effect, so it is not counted", () => {
    expect(keysBeyondActor(["view:patients:branch"], [], [], [])).toEqual([]);
    expect(keysBeyondActor(["view:patients:branch"], [], [], ON)).toEqual(["view:patients:branch"]);
  });

  it("the Clinic Admin's keys (whole catalogue at clinic scope) cover any role", () => {
    const admin = PERMISSION_CATALOG.filter((p) => p.scope === "clinic").map((p) => p.key);
    const every = PERMISSION_CATALOG.map((p) => p.key);
    expect(keysBeyondActor(every, [], admin, ON)).toEqual([]);
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
