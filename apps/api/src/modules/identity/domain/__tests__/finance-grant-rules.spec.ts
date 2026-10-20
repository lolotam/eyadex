import { describe, expect, it } from "vitest";

import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";

import { SYSTEM_ROLES } from "../system-roles.ts";
import { uncoveredKeys } from "../grant-rules.ts";

// Finance F1 (spec §3.1, FIN-4, R1-12, R2-4): the new clinics' default roles and who may grant the keys.
const roleKeys = (key: string) => [...SYSTEM_ROLES.find((r) => r.key === key)!.permissions];
const financeKeys = (scope?: string) =>
  PERMISSION_CATALOG.filter(
    (p) => p.module === "finance" && (scope === undefined || p.scope === scope),
  ).map((p) => p.key);

describe("finance keys of the new clinics' system roles (FIN-4)", () => {
  it("give the locked admin exactly the twelve clinic-scope finance keys", () => {
    const admin = roleKeys("clinic_admin").filter((k) => financeKeys().includes(k));
    expect(admin.sort()).toEqual(
      [
        "view:invoices:clinic",
        "create:invoices:clinic",
        "update:invoices:clinic",
        "deactivate:invoices:clinic",
        "create:discounts:clinic",
        "view:prices:clinic",
        "update:prices:clinic",
        "view:payments:clinic",
        "create:payments:clinic",
        "create:refunds:clinic",
        "view:cash_closings:clinic",
        "create:cash_closings:clinic",
      ].sort(),
    );
    expect(admin.sort()).toEqual(financeKeys("clinic").sort());
  });

  it("let the front desk invoice, record payments and close its branches' cash, without refunds", () => {
    const desk = roleKeys("receptionist").filter((k) => financeKeys().includes(k));
    expect(desk.sort()).toEqual(
      [
        "view:invoices:branch",
        "create:invoices:branch",
        "update:invoices:branch",
        "view:prices:clinic",
        "view:payments:branch",
        "create:payments:branch",
        "view:cash_closings:branch",
        "create:cash_closings:branch",
      ].sort(),
    );
  });

  it("give the front desk no refund key, which stays with the admin (F2-Q15)", () => {
    expect(roleKeys("receptionist").some((k) => k.includes(":refunds:"))).toBe(false);
  });

  it("let the doctor read its own patients' invoices only", () => {
    expect(roleKeys("doctor").filter((k) => financeKeys().includes(k))).toEqual([
      "view:invoices:own",
    ]);
  });

  it("give the technician no finance key", () => {
    expect(roleKeys("technician").filter((k) => financeKeys().includes(k))).toEqual([]);
  });
});

describe("granting view:invoices:own (R1-12)", () => {
  it("needs view:invoices:clinic — a branch key does not cover a reach that crosses branches", () => {
    expect(uncoveredKeys(["view:invoices:branch"], ["view:invoices:own"])).toEqual([
      "view:invoices:own",
    ]);
    expect(uncoveredKeys(["view:invoices:clinic"], ["view:invoices:own"])).toEqual([]);
  });

  it("is within the locked admin's own keys, so it grants the doctor role without delegation", () => {
    expect(
      uncoveredKeys(
        roleKeys("clinic_admin"),
        roleKeys("doctor").filter((k) => k.includes("invoices")),
      ),
    ).toEqual([]);
  });
});
