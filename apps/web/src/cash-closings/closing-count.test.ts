import { describe, expect, it } from "vitest";
import {
  closableBranches,
  countedMinorOf,
  differenceKind,
  differenceOf,
  needsNote,
} from "./closing-count";

const B1 = "00000000-0000-4000-8000-000000000001";
const B2 = "00000000-0000-4000-8000-000000000002";
const branches = [B1, B2].map((id) => ({ id, nameAr: id, nameEn: id, isActive: true }));

describe("the count", () => {
  it("accepts zero and more in major units; refuses negative or empty", () => {
    expect(countedMinorOf("0", 3)).toBe("0");
    expect(countedMinorOf("12.5", 3)).toBe("12500");
    expect(countedMinorOf("-1", 3)).toBeNull();
    expect(countedMinorOf("", 3)).toBeNull();
  });

  it("the difference is counted minus expected, a shortage negative even when expected is", () => {
    expect(differenceKind(differenceOf("4500", "5000"))).toBe("shortage");
    expect(differenceKind(differenceOf("0", "-2000"))).toBe("surplus");
    expect(differenceKind(differenceOf("5000", "5000"))).toBe("balanced");
  });

  it("a note is needed only when the count differs", () => {
    expect(needsNote(0n, "")).toBe(false);
    expect(needsNote(-1n, "  ")).toBe(true);
    expect(needsNote(-1n, "سبب")).toBe(false);
  });
});

describe("closable branches (create:cash_closings at the branch)", () => {
  it("the branch key offers the user's branches only; the clinic key offers all", () => {
    const desk = {
      permissions: ["create:cash_closings:branch"],
      allBranches: false,
      branchIds: [B2],
    };
    expect(closableBranches(desk, branches).map((b) => b.id)).toEqual([B2]);
    const admin = {
      permissions: ["create:cash_closings:clinic"],
      allBranches: false,
      branchIds: [],
    };
    expect(closableBranches(admin, branches)).toHaveLength(2);
  });

  it("NEGATIVE: view:cash_closings alone offers no branch", () => {
    const viewer = { permissions: ["view:cash_closings:clinic"], allBranches: true, branchIds: [] };
    expect(closableBranches(viewer, branches)).toEqual([]);
  });
});
