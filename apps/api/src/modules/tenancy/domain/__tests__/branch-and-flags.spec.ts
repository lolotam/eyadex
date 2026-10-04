import { describe, expect, it } from "vitest";

import { decideBranchDeactivation } from "../branch-rules.ts";
import { isModuleEnabled } from "../feature-flags.ts";

describe("decideBranchDeactivation (OD-7)", () => {
  it("refuses the last active branch", () => {
    expect(decideBranchDeactivation({ id: "b1", isActive: true }, 1)).toBe("last_active_branch");
  });

  it("allows when another active branch remains", () => {
    expect(decideBranchDeactivation({ id: "b1", isActive: true }, 2)).toBe("allowed");
  });

  it("reports an already inactive branch", () => {
    expect(decideBranchDeactivation({ id: "b1", isActive: false }, 1)).toBe("already_inactive");
  });
});

describe("isModuleEnabled", () => {
  it("is true only for an enabled row", () => {
    expect(isModuleEnabled([{ module: "patients", enabled: true }], "patients")).toBe(true);
    expect(isModuleEnabled([{ module: "patients", enabled: false }], "patients")).toBe(false);
  });

  it("denies a module with no row", () => {
    expect(isModuleEnabled([], "patients")).toBe(false);
  });
});
