import { describe, expect, it } from "vitest";
import { canAtBranch } from "./can-at-branch";

const B1 = "00000000-0000-4000-8000-000000000001";
const B2 = "00000000-0000-4000-8000-000000000002";
const at =
  (permissions: string[], allBranches = false, branchIds = [B1]) =>
  (branchId: string) =>
    canAtBranch({ permissions, allBranches, branchIds }, "update", "schedules", branchId);

describe("canAtBranch", () => {
  it("the clinic key reaches every branch", () => {
    expect(at(["update:schedules:clinic"], false, [])(B2)).toBe(true);
  });

  it("the branch key reaches the user's own branches only, or all when it has every branch", () => {
    expect(at(["update:schedules:branch"])(B1)).toBe(true);
    expect(at(["update:schedules:branch"])(B2)).toBe(false);
    expect(at(["update:schedules:branch"], true, [])(B2)).toBe(true);
  });

  it("NEGATIVE: an own key, another action or another resource reaches no branch", () => {
    expect(at(["update:schedules:own"])(B1)).toBe(false);
    expect(at(["view:schedules:clinic"])(B1)).toBe(false);
    expect(at(["update:services:clinic"])(B1)).toBe(false);
  });
});
