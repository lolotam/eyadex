import { describe, expect, it } from "vitest";

import { PERMISSION_CATALOG, VIEWED_THROUGH, viewScopeCovers } from "../permissions.ts";
import { permissionKeysSchema } from "../roles.ts";

const accepts = (keys: string[]) => permissionKeysSchema.safeParse(keys).success;

// Issue #93: a write needs a view on its resource (or the one it is viewed through) that reaches as far.
describe("a view key must cover the scope of the writes it unlocks", () => {
  it.each([
    ["payments", ["view:payments:branch", "create:payments:clinic"]],
    ["refunds through payments", ["view:payments:branch", "create:refunds:clinic"]],
    ["cash closings", ["view:cash_closings:branch", "create:cash_closings:clinic"]],
    ["invoices", ["view:invoices:branch", "create:invoices:clinic"]],
    ["discounts through invoices", ["view:invoices:branch", "create:discounts:clinic"]],
    ["patients from an own view", ["view:patients:own", "update:patients:branch"]],
    ["medical content", ["view:medical:own", "update:medical:clinic"]],
  ])("NEGATIVE: refuses a %s write wider than its view", (_label, keys) => {
    const result = permissionKeysSchema.safeParse(keys);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("validation.needsView");
  });

  it.each([
    ["the same scope", ["view:payments:branch", "create:payments:branch"]],
    ["a wider view", ["view:payments:clinic", "create:payments:branch"]],
    ["a clinic view over a clinic write", ["view:invoices:clinic", "create:discounts:clinic"]],
    ["a branch view over an own write", ["view:visits:branch", "create:visits:own"]],
    ["an own view over an own write", ["view:medical:own", "update:medical:own"]],
  ])("accepts %s", (_label, keys) => {
    expect(accepts(keys)).toBe(true);
  });

  it("orders the scopes clinic, branch, own", () => {
    expect(viewScopeCovers("clinic", "branch")).toBe(true);
    expect(viewScopeCovers("clinic", "own")).toBe(true);
    expect(viewScopeCovers("branch", "own")).toBe(true);
    expect(viewScopeCovers("branch", "clinic")).toBe(false);
    expect(viewScopeCovers("own", "branch")).toBe(false);
  });

  // The rule is always satisfiable: every write scope in the catalogue has a covering view to pick.
  it("every write key in the catalogue passes with a covering view of its resource", () => {
    for (const write of PERMISSION_CATALOG.filter((p) => p.action !== "view")) {
      const viewed = VIEWED_THROUGH[write.resource] ?? write.resource;
      const view = PERMISSION_CATALOG.find(
        (p) =>
          p.action === "view" && p.resource === viewed && viewScopeCovers(p.scope, write.scope),
      );
      expect(view, write.key).toBeDefined();
      expect(accepts([view?.key ?? "", write.key]), write.key).toBe(true);
    }
  });
});
