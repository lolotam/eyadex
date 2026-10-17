import { describe, expect, it } from "vitest";

import { moduleDependencyGap } from "../onboarding.ts";
import { PERMISSION_CATALOG, PERMISSION_KEYS } from "../permissions.ts";
import { permissionKeysSchema } from "../roles.ts";

// docs/specs/finance-design.md §3.1 and §8c.3: exactly 13 finance keys — invoices 9, discounts 2, prices 2 —
// in the order buildCatalog() emits (resource, then action, then scope), which the 0060 seed ids follow.
const FINANCE_KEYS = [
  "view:invoices:clinic",
  "view:invoices:branch",
  "view:invoices:own",
  "create:invoices:clinic",
  "create:invoices:branch",
  "update:invoices:clinic",
  "update:invoices:branch",
  "deactivate:invoices:clinic",
  "deactivate:invoices:branch",
  "create:discounts:clinic",
  "create:discounts:branch",
  "view:prices:clinic",
  "update:prices:clinic",
];

describe("finance permissions (F1 §3.1)", () => {
  it("are exactly the 13 finance keys, in catalogue order, all gated by the finance module", () => {
    const finance = PERMISSION_CATALOG.filter((p) => p.module === "finance");
    expect(finance.map((p) => p.key)).toEqual(FINANCE_KEYS);
    expect(new Set(finance.map((p) => p.resource))).toEqual(
      new Set(["invoices", "discounts", "prices"]),
    );
  });

  it("follow every non-finance key, so the existing seed ids keep their order", () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key);
    expect(keys.slice(-13)).toEqual(FINANCE_KEYS);
  });

  it("are written out in PERMISSION_KEYS", () => {
    expect(PERMISSION_KEYS.filter((k) => FINANCE_KEYS.includes(k))).toEqual(FINANCE_KEYS);
  });

  it("allow `own` only to view invoices", () => {
    const own = PERMISSION_CATALOG.filter((p) => p.module === "finance" && p.scope === "own");
    expect(own.map((p) => p.key)).toEqual(["view:invoices:own"]);
  });
});

describe("a role holding the discount key (R1-14)", () => {
  it("needs view on invoices, since discounts have no view of their own", () => {
    expect(permissionKeysSchema.safeParse(["create:discounts:branch"]).success).toBe(false);
    expect(
      permissionKeysSchema.safeParse([
        "view:invoices:branch",
        "update:invoices:branch",
        "create:discounts:branch",
      ]).success,
    ).toBe(true);
  });

  it("still needs view on prices to update them", () => {
    expect(permissionKeysSchema.safeParse(["update:prices:clinic"]).success).toBe(false);
    expect(
      permissionKeysSchema.safeParse(["view:prices:clinic", "update:prices:clinic"]).success,
    ).toBe(true);
  });
});

describe("the finance module", () => {
  it("needs the patients module", () => {
    expect(
      moduleDependencyGap({ patients: false, appointments: true, medical: false, finance: true }),
    ).toEqual({ module: "finance", requires: "patients" });
    expect(
      moduleDependencyGap({ patients: true, appointments: false, medical: false, finance: true }),
    ).toBeNull();
  });
});
