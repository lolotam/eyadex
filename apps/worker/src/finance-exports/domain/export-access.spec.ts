import { describe, expect, it } from "vitest";

import type { ExportAccessSnapshot } from "./export-access.ts";
import { decideExportAccess } from "./export-access.ts";

const EAST = "11111111-1111-4111-8111-111111111111";
const INACTIVE = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "33333333-3333-4333-8333-333333333333";

const snapshot = (extra: Partial<ExportAccessSnapshot> = {}): ExportAccessSnapshot => ({
  userId: "user-1",
  membershipActive: true,
  roleActive: true,
  clinicStatus: "active",
  expiresUs: "200",
  observedUs: "100",
  financeEnabled: true,
  permissions: ["view:report_takings:clinic", "view:payments:clinic"],
  allBranches: false,
  activeAssignedBranchIds: [EAST],
  clinicBranchIds: [EAST, INACTIVE],
  ...extra,
});

describe("decideExportAccess", () => {
  it("keeps a stored branch ceiling when the current grant is wider", () => {
    const decision = decideExportAccess({
      report: "daily_takings",
      storedScope: "branch",
      branchIds: [EAST],
      snapshot: snapshot({
        permissions: [
          "view:report_takings:clinic",
          "view:report_takings:branch",
          "view:payments:clinic",
        ],
        activeAssignedBranchIds: [EAST, FOREIGN],
      }),
    });
    expect(decision).toEqual({ kind: "ready", userId: "user-1" });
  });

  it("refuses a stored clinic ceiling after the current scope narrows", () => {
    expect(
      decideExportAccess({
        report: "daily_takings",
        storedScope: "clinic",
        branchIds: [EAST],
        snapshot: snapshot({
          permissions: ["view:report_takings:branch", "view:payments:branch"],
        }),
      }),
    ).toEqual({ kind: "forbidden" });
  });

  it("treats an equal clinic instant as expired and a microsecond before as open", () => {
    expect(
      decideExportAccess({
        report: "daily_takings",
        storedScope: "clinic",
        branchIds: [EAST, INACTIVE],
        snapshot: snapshot({ observedUs: "200", expiresUs: "200" }),
      }),
    ).toEqual({ kind: "forbidden" });
    expect(
      decideExportAccess({
        report: "daily_takings",
        storedScope: "clinic",
        branchIds: [EAST, INACTIVE],
        snapshot: snapshot({ clinicStatus: "trial", observedUs: "199", expiresUs: "200" }),
      }).kind,
    ).toBe("ready");
  });

  it("refuses a suspended clinic, a disabled role, and finance that is off", () => {
    for (const extra of [
      { clinicStatus: "suspended", expiresUs: "999" },
      { roleActive: false },
      { financeEnabled: false },
      { membershipActive: false },
    ]) {
      expect(
        decideExportAccess({
          report: "daily_takings",
          storedScope: "clinic",
          branchIds: [],
          snapshot: snapshot(extra),
        }),
      ).toEqual({ kind: "forbidden" });
    }
  });

  it("refuses own covered by a wider invoice key and an unsupported stored scope", () => {
    expect(
      decideExportAccess({
        report: "own_summary",
        storedScope: "own",
        branchIds: [EAST, INACTIVE],
        snapshot: snapshot({
          permissions: ["view:report_own:own", "view:invoices:clinic"],
          allBranches: true,
        }),
      }),
    ).toEqual({ kind: "forbidden" });
    expect(
      decideExportAccess({
        report: "patient_credit",
        storedScope: "branch",
        branchIds: [EAST],
        snapshot: snapshot({
          permissions: ["view:report_patients:clinic", "view:payments:clinic"],
        }),
      }),
    ).toEqual({ kind: "forbidden" });
    expect(
      decideExportAccess({
        report: "by_service",
        storedScope: "own",
        branchIds: [],
        snapshot: snapshot({
          permissions: ["view:report_analytics:clinic", "view:invoices:clinic"],
        }),
      }),
    ).toEqual({ kind: "forbidden" });
  });

  it("reaches inactive clinic branches for clinic or all-branch, and only active assigned otherwise", () => {
    expect(
      decideExportAccess({
        report: "refunds",
        storedScope: "branch",
        branchIds: [INACTIVE],
        snapshot: snapshot({
          permissions: ["view:report_patients:branch", "view:payments:branch"],
          allBranches: true,
        }),
      }).kind,
    ).toBe("ready");
    expect(
      decideExportAccess({
        report: "refunds",
        storedScope: "branch",
        branchIds: [INACTIVE],
        snapshot: snapshot({
          permissions: ["view:report_patients:branch", "view:payments:branch"],
        }),
      }),
    ).toEqual({ kind: "forbidden" });
    expect(
      decideExportAccess({
        report: "refunds",
        storedScope: "branch",
        branchIds: [FOREIGN],
        snapshot: snapshot({
          permissions: ["view:report_patients:branch", "view:payments:branch"],
          allBranches: true,
        }),
      }),
    ).toEqual({ kind: "forbidden" });
  });
});
