import { describe, expect, it } from "vitest";
import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";
import { permissionKeysSchema } from "@eyadex/contracts/roles";
import { ROLE_TEMPLATES } from "@/shared/api/mock/seed-roles";
import { withScope } from "./matrix-keys";

const catalog = [...PERMISSION_CATALOG];
const sorted = (keys: string[]) => [...keys].sort();

// Issue #93: the editor keeps every write inside the reach of its view, so a save never trips the rule.
describe("the matrix keys after one cell changes", () => {
  it("granting a write alone adds the view of the same scope", () => {
    expect(
      withScope(catalog, [], { resource: "payments", action: "create", scope: "branch" }),
    ).toEqual(["create:payments:branch", "view:payments:branch"]);
  });

  it("granting a write wider than the held view widens the view", () => {
    const next = withScope(catalog, ["view:payments:branch"], {
      resource: "payments",
      action: "create",
      scope: "clinic",
    });
    expect(sorted(next)).toEqual(["create:payments:clinic", "view:payments:clinic"]);
    expect(permissionKeysSchema.safeParse(next).success).toBe(true);
  });

  it("widens the viewed-through resource's view for a refund or a discount", () => {
    const refunds = withScope(catalog, ["view:payments:branch"], {
      resource: "refunds",
      action: "create",
      scope: "clinic",
    });
    expect(sorted(refunds)).toEqual(["create:refunds:clinic", "view:payments:clinic"]);
    const discounts = withScope(catalog, ["view:invoices:own"], {
      resource: "discounts",
      action: "create",
      scope: "branch",
    });
    expect(sorted(discounts)).toEqual(["create:discounts:branch", "view:invoices:branch"]);
  });

  it("keeps a held view that already covers the write", () => {
    const held = ["view:visits:branch"];
    expect(
      withScope(catalog, held, { resource: "visits", action: "create", scope: "own" }),
    ).toEqual(["view:visits:branch", "create:visits:own"]);
  });

  it("narrowing a view drops the writes it no longer covers, its dependents included", () => {
    const keys = [
      "view:payments:clinic",
      "create:payments:clinic",
      "create:refunds:branch",
      "view:invoices:clinic",
    ];
    const next = withScope(catalog, keys, {
      resource: "payments",
      action: "view",
      scope: "branch",
    });
    expect(sorted(next)).toEqual([
      "create:refunds:branch",
      "view:invoices:clinic",
      "view:payments:branch",
    ]);
    expect(permissionKeysSchema.safeParse(next).success).toBe(true);
  });

  it("dropping a view drops every write it unlocks", () => {
    const keys = ["view:invoices:branch", "create:invoices:branch", "create:discounts:branch"];
    expect(withScope(catalog, keys, { resource: "invoices", action: "view", scope: null })).toEqual(
      [],
    );
  });
});

describe("the mock's ready roles", () => {
  it.each(Object.entries(ROLE_TEMPLATES))("%s passes the view-scope rule", (_key, template) => {
    expect(permissionKeysSchema.safeParse(template.permissions).success).toBe(true);
  });
});
