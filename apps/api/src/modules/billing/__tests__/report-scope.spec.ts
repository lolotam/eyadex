import { REPORT_IDS, type ReportId } from "@eyadex/contracts/finance-reports";
import { describe, expect, it } from "vitest";

import type { BillingActor } from "../domain/billing-actor.ts";
import { reportBranchIds, reportScope } from "../domain/report-scope.ts";

const actor = (permissions: readonly string[]): BillingActor => ({
  clinicId: "clinic",
  userId: "user",
  membershipId: "doctor",
  permissions,
  member: { all: false, branchIds: ["east"] },
});

describe("report reach and covering keys", () => {
  it("the receptionist's takings key opens R1/R2/R9 and no patient or analytics report", () => {
    const desk = actor([
      "view:report_takings:branch",
      "view:invoices:branch",
      "view:payments:branch",
      "view:cash_closings:branch",
    ]);
    expect(REPORT_IDS.filter((id) => reportScope(desk, id) !== null)).toEqual([
      "daily_takings",
      "period_summary",
      "cash_closings",
    ]);
    expect(reportScope(desk, "daily_takings")).toEqual({
      scope: "branch",
      branches: { all: false, branchIds: ["east"] },
    });
  });

  it.each<[ReportId, string, readonly string[]]>([
    ["daily_takings", "report_takings", ["payments"]],
    ["period_summary", "report_takings", ["invoices", "payments"]],
    ["cash_closings", "report_takings", ["cash_closings"]],
    ["by_service", "report_analytics", ["invoices"]],
    ["by_doctor", "report_analytics", ["invoices"]],
    ["outstanding", "report_patients", ["invoices"]],
    ["refunds", "report_patients", ["payments"]],
    ["discounts", "report_patients", ["invoices"]],
  ])("%s refuses every missing or narrower covering key", (report, resource, covers) => {
    const reportKey = `view:${resource}:clinic`;
    const keys = covers.map((r) => `view:${r}:clinic`);
    expect(reportScope(actor([reportKey, ...keys]), report)?.scope).toBe("clinic");
    for (const missing of keys) {
      expect(
        reportScope(actor([reportKey, ...keys.filter((k) => k !== missing)]), report),
      ).toBeNull();
    }
    expect(
      reportScope(actor([reportKey, ...covers.map((r) => `view:${r}:branch`)]), report),
    ).toBeNull();
    expect(reportScope(actor([`view:${resource}:branch`, ...keys]), report)?.scope).toBe("branch");
    expect(reportScope(actor(keys), report)).toBeNull();
  });

  it("does not downgrade a clinic report to rescue a narrower covering key", () => {
    expect(
      reportScope(
        actor([
          "view:report_patients:clinic",
          "view:report_patients:branch",
          "view:invoices:branch",
        ]),
        "outstanding",
      ),
    ).toBeNull();
  });

  it("credit requires both clinic keys even for an all-branch member", () => {
    for (const keys of [
      ["view:report_patients:branch", "view:payments:clinic"],
      ["view:report_patients:clinic", "view:payments:branch"],
    ])
      expect(reportScope({ ...actor(keys), member: { all: true } }, "patient_credit")).toBeNull();
    expect(
      reportScope(actor(["view:report_patients:clinic", "view:payments:clinic"]), "patient_credit"),
    ).toEqual({ scope: "clinic", branches: { all: true } });
  });

  it("own crosses membership branches but requires the exact own invoice key", () => {
    const keys = ["view:report_own:own", "view:invoices:own"];
    const reach = reportScope(actor(keys), "own_summary")!;
    expect(reportBranchIds(reach, ["east", "west"], "west")).toEqual(["west"]);
    for (const covering of ["branch", "clinic"]) {
      expect(reportScope(actor([keys[0]!, `view:invoices:${covering}`]), "own_summary")).toBeNull();
    }
    expect(reportScope(actor(keys), "outstanding")).toBeNull();
    expect(
      reportScope(actor(["view:report_patients:clinic", "view:invoices:own"]), "own_summary"),
    ).toBeNull();
  });

  it("passes explicit clinic branches, including inactive ones, and refuses foreign filters", () => {
    const reach = reportScope(
      actor(["view:report_takings:clinic", "view:payments:clinic"]),
      "daily_takings",
    )!;
    expect(reportBranchIds(reach, ["east", "inactive"])).toEqual(["east", "inactive"]);
    expect(reportBranchIds(reach, ["east", "inactive"], "inactive")).toEqual(["inactive"]);
    expect(reportBranchIds(reach, ["east"], "foreign")).toBeNull();
    const branch = {
      scope: "branch" as const,
      branches: { all: false as const, branchIds: ["east"] },
    };
    expect(reportBranchIds(branch, ["east", "west"])).toEqual(["east"]);
    expect(reportBranchIds(branch, ["east", "west"], "west")).toBeNull();
    expect(reportBranchIds(branch, [])).toEqual([]);
  });
});
