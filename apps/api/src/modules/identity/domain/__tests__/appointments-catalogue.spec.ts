import {
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  permissionSchema,
} from "@eyadex/contracts/permissions";
import { permissionKeysSchema } from "@eyadex/contracts/roles";
import { describe, expect, it } from "vitest";

import { SYSTEM_ROLES } from "../system-roles.ts";

const ADDED = [
  "view:appointments:clinic",
  "view:appointments:branch",
  "view:appointments:own",
  "create:appointments:clinic",
  "create:appointments:branch",
  "update:appointments:clinic",
  "update:appointments:branch",
  "overbook:appointments:clinic",
  "overbook:appointments:branch",
  "view:services:clinic",
  "create:services:clinic",
  "update:services:clinic",
  "deactivate:services:clinic",
  "view:schedules:clinic",
  "view:schedules:branch",
  "update:schedules:clinic",
  "update:schedules:branch",
];

// Appointments spec §3, slice A1: the catalogue entries only; `own` is enforced in queries from A3.
describe("the appointments catalogue", () => {
  it("adds exactly the module's keys, every one gated by the appointments module", () => {
    const added = PERMISSION_CATALOG.filter((p) => p.module === "appointments").map((p) => p.key);
    expect(added).toEqual(ADDED);
  });

  it("offers `own` only on view:appointments; view:patients:own waits for A3", () => {
    const own = PERMISSION_CATALOG.filter((p) => p.scope === "own").map((p) => p.key);
    expect(own).toEqual(["view:appointments:own"]);
  });

  it("keeps every key valid, and PERMISSION_KEYS equal to the catalogue", () => {
    for (const { key } of PERMISSION_CATALOG)
      expect(permissionSchema.safeParse(key).success).toBe(true);
    expect([...PERMISSION_KEYS]).toEqual(PERMISSION_CATALOG.map((p) => p.key));
  });

  it("a role holds one scope per action on every resource, not only on patients", () => {
    const twoViews = ["view:appointments:branch", "view:appointments:own"];
    expect(permissionKeysSchema.safeParse(twoViews).success).toBe(false);
    const mixed = ["view:schedules:clinic", "update:schedules:branch"];
    expect(permissionKeysSchema.safeParse(mixed).success).toBe(true);
  });

  it("overbook is a write: it needs view on appointments like any other", () => {
    expect(permissionKeysSchema.safeParse(["overbook:appointments:branch"]).success).toBe(false);
    const withView = ["view:appointments:branch", "overbook:appointments:branch"];
    expect(permissionKeysSchema.safeParse(withView).success).toBe(true);
  });
});

// Owner decision 2026-10-10 (slice A2): new clinics' front desk books in its branches. Existing clinics'
// roles are not changed by a migration; the doctor's `own` keys wait for A3.
describe("new clinics' system roles (A2)", () => {
  const keysOf = (key: string) => SYSTEM_ROLES.find((r) => r.key === key)?.permissions;

  it("the receptionist books, moves and follows appointments in its branches", () => {
    expect(keysOf("receptionist")).toEqual([
      "view:patients:branch",
      "create:patients:branch",
      "update:patients:branch",
      "view:appointments:branch",
      "create:appointments:branch",
      "update:appointments:branch",
      "view:schedules:branch",
      "view:services:clinic",
    ]);
    expect(permissionKeysSchema.safeParse(keysOf("receptionist")).success).toBe(true);
  });

  it("the doctor and the technician keep their keys until A3", () => {
    expect(keysOf("doctor")).toEqual(["view:patients:branch"]);
    expect(keysOf("technician")).toEqual(["view:patients:branch"]);
  });
});
