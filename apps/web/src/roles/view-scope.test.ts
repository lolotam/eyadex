import { describe, expect, it } from "vitest";
import type { PermissionDefinition } from "@eyadex/contracts/permissions";
import { viewScope } from "./view-scope";

const def = (scope: string) =>
  ({ action: "view", resource: "invoices", scope }) as unknown as PermissionDefinition;

describe("the view scope granted with a write", () => {
  it("keeps the same scope when the view offers it", () => {
    expect(viewScope([def("own"), def("branch")], "invoices", "branch")).toBe("branch");
  });
  it("falls back to the widest scope, not the first one listed", () => {
    expect(viewScope([def("own"), def("branch"), def("clinic")], "invoices", "x")).toBe("clinic");
    expect(viewScope([def("own"), def("branch")], "invoices", "x")).toBe("branch");
  });
});
