import { describe, expect, it } from "vitest";

import { branchAuditSnapshot, decideBranchReactivation } from "../branch-rules.ts";
import { checkLimit, branchesUsage } from "../limits.ts";

describe("decideBranchReactivation (SUB-03)", () => {
  const inactive = { id: "b1", isActive: false };

  it("allows below the limit", () => {
    expect(decideBranchReactivation(inactive, 2, 3)).toBe("allowed");
  });

  it("refuses at the limit: a reactivated branch counts like a new one", () => {
    expect(decideBranchReactivation(inactive, 3, 3)).toBe("limit_reached");
  });

  it("refuses above a lowered limit", () => {
    expect(decideBranchReactivation(inactive, 4, 2)).toBe("limit_reached");
  });

  it("reports an already active branch without touching the limit", () => {
    expect(decideBranchReactivation({ id: "b1", isActive: true }, 3, 3)).toBe("already_active");
  });
});

describe("branch create limit", () => {
  it("reaching the limit exactly is allowed, passing it is not", () => {
    expect(checkLimit(branchesUsage(2, 3)).kind).toBe("within");
    expect(checkLimit(branchesUsage(3, 3))).toEqual({ kind: "exceeded", used: 3, max: 3 });
  });
});

describe("branchAuditSnapshot", () => {
  it("keeps an optional invoice prefix while old snapshots keep their shape", () => {
    const branch = { nameAr: "فرع", nameEn: "Branch", address: null, phone: null, isActive: true };
    expect(branchAuditSnapshot({ ...branch, invoicePrefix: "123456" })).toEqual({
      ...branch,
      invoicePrefix: "123456",
    });
    expect(branchAuditSnapshot(branch)).toEqual(branch);
  });

  it("keeps the allowlisted fields only", () => {
    const row = {
      nameAr: "ف",
      nameEn: "B",
      address: null,
      phone: "+96500000000",
      isActive: true,
      id: "x",
      clinicId: "y",
      createdAt: "z",
    };
    expect(branchAuditSnapshot(row)).toEqual({
      nameAr: "ف",
      nameEn: "B",
      address: null,
      phone: "+96500000000",
      isActive: true,
    });
  });
});
