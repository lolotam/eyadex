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

// Appointments spec §3, slice A1: the catalogue entries; `own` is enforced in queries from A3.
describe("the appointments catalogue", () => {
  it("adds exactly the module's keys, every one gated by the appointments module", () => {
    const added = PERMISSION_CATALOG.filter((p) => p.module === "appointments").map((p) => p.key);
    expect(added).toEqual(ADDED);
  });

  it("offers `own` on appointments and (A3) patients views, and (P2) on visits and the medical content", () => {
    const own = PERMISSION_CATALOG.filter((p) => p.scope === "own").map((p) => p.key);
    expect(own).toEqual([
      "view:patients:own",
      "view:appointments:own",
      "view:visits:own",
      "create:visits:own",
      "view:medical:own",
      "update:medical:own",
    ]);
    const patientsOwn = PERMISSION_CATALOG.find((p) => p.key === "view:patients:own");
    expect(patientsOwn?.module).toBe("patients");
  });

  it("keeps every key valid, and PERMISSION_KEYS equal to the catalogue", () => {
    for (const { key } of PERMISSION_CATALOG)
      expect(permissionSchema.safeParse(key).success).toBe(true);
    expect([...PERMISSION_KEYS]).toEqual(PERMISSION_CATALOG.map((p) => p.key));
  });

  it("a role holds one scope per action on every resource, not only on patients", () => {
    const twoViews = ["view:appointments:branch", "view:appointments:own"];
    expect(permissionKeysSchema.safeParse(twoViews).success).toBe(false);
    const twoPatientViews = ["view:patients:clinic", "view:patients:own"];
    expect(permissionKeysSchema.safeParse(twoPatientViews).success).toBe(false);
    const mixed = ["view:schedules:clinic", "update:schedules:branch"];
    expect(permissionKeysSchema.safeParse(mixed).success).toBe(true);
  });

  it("overbook is a write: it needs view on appointments like any other", () => {
    expect(permissionKeysSchema.safeParse(["overbook:appointments:branch"]).success).toBe(false);
    const withView = ["view:appointments:branch", "overbook:appointments:branch"];
    expect(permissionKeysSchema.safeParse(withView).success).toBe(true);
  });
});

// Owner decision 2026-10-10 (slice A2): new clinics' front desk books in its branches. Slice A3 (D-8): the
// doctor sees its own appointments and patients. Existing clinics' roles are not changed by a migration.
describe("new clinics' system roles (A2, A3)", () => {
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

  it("A3 (D-8): the doctor holds only the own keys; the technician keeps its keys", () => {
    expect(keysOf("doctor")).toEqual(["view:appointments:own", "view:patients:own"]);
    expect(permissionKeysSchema.safeParse(keysOf("doctor")).success).toBe(true);
    expect(keysOf("technician")).toEqual(["view:patients:branch"]);
  });
});

// P2 (R1-4, R1-10): the medical module's ten keys join the catalogue now, but reach no role until its
// release (0051); a new clinic's admin is built without them.
describe("the medical catalogue (P2)", () => {
  it("adds exactly the module's keys, every one gated by the medical module", () => {
    const added = PERMISSION_CATALOG.filter((p) => p.module === "medical").map((p) => p.key);
    expect(added).toEqual([
      "view:visits:clinic",
      "view:visits:branch",
      "view:visits:own",
      "create:visits:own",
      "view:medical:clinic",
      "view:medical:own",
      "update:medical:clinic",
      "update:medical:own",
      "view:medicines:clinic",
      "update:medicines:clinic",
    ]);
  });

  it("gives no system role a medical key before the release", () => {
    for (const role of SYSTEM_ROLES) {
      const medical = role.permissions.filter((key) =>
        /^\w+:(visits|medical|medicines):/.test(key),
      );
      expect(medical).toEqual([]);
    }
    const admin = SYSTEM_ROLES.find((r) => r.key === "clinic_admin")?.permissions;
    expect(admin).toContain("view:schedules:clinic");
    expect(permissionKeysSchema.safeParse(admin).success).toBe(true);
  });
});
