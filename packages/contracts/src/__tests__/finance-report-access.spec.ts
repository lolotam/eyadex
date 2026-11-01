import { describe, expect, it } from "vitest";

import { reportPermissionScope, reportScopeSupported } from "../finance-report-access.ts";
import { REPORT_IDS, type ReportId } from "../finance-reports-rows.ts";
import type { PermissionScope } from "../permissions.ts";

interface ReportRule {
  readonly report: ReportId;
  readonly scopes: readonly PermissionScope[];
  readonly resource: string;
  readonly covering: readonly string[];
}

/** Spec §3–§4 outcomes, written out so they are not derived from the resolver table. */
const RULES: readonly ReportRule[] = [
  {
    report: "daily_takings",
    scopes: ["clinic", "branch"],
    resource: "report_takings",
    covering: ["payments"],
  },
  {
    report: "period_summary",
    scopes: ["clinic", "branch"],
    resource: "report_takings",
    covering: ["invoices", "payments"],
  },
  {
    report: "by_service",
    scopes: ["clinic", "branch"],
    resource: "report_analytics",
    covering: ["invoices"],
  },
  {
    report: "by_doctor",
    scopes: ["clinic", "branch"],
    resource: "report_analytics",
    covering: ["invoices"],
  },
  {
    report: "outstanding",
    scopes: ["clinic", "branch"],
    resource: "report_patients",
    covering: ["invoices"],
  },
  {
    report: "patient_credit",
    scopes: ["clinic"],
    resource: "report_patients",
    covering: ["payments"],
  },
  {
    report: "refunds",
    scopes: ["clinic", "branch"],
    resource: "report_patients",
    covering: ["payments"],
  },
  {
    report: "discounts",
    scopes: ["clinic", "branch"],
    resource: "report_patients",
    covering: ["invoices"],
  },
  {
    report: "cash_closings",
    scopes: ["clinic", "branch"],
    resource: "report_takings",
    covering: ["cash_closings"],
  },
  { report: "own_summary", scopes: ["own"], resource: "report_own", covering: ["invoices"] },
];

const keysFor = (row: ReportRule, scope: PermissionScope): string[] => [
  `view:${row.resource}:${scope}`,
  ...row.covering.map((resource) => `view:${resource}:${scope}`),
];

describe("report permission scope", () => {
  it("covers all ten reports and no extra one", () => {
    expect(RULES.map((row) => row.report)).toEqual([...REPORT_IDS]);
  });

  it.each(RULES)("$report accepts only its supported scopes", (row) => {
    for (const scope of ["clinic", "branch", "own"] as const) {
      expect(reportScopeSupported(row.report, scope)).toBe(row.scopes.includes(scope));
    }
  });

  it.each(RULES)("$report resolves each supported scope when covering keys match", (row) => {
    for (const scope of row.scopes) {
      expect(reportPermissionScope(keysFor(row, scope), row.report)).toBe(scope);
    }
  });

  it.each(RULES)("$report refuses a missing report key or any missing covering key", (row) => {
    const scope = row.scopes[0]!;
    const reportKey = `view:${row.resource}:${scope}`;
    const covers = row.covering.map((resource) => `view:${resource}:${scope}`);
    expect(reportPermissionScope(covers, row.report)).toBeNull();
    for (const missing of covers) {
      expect(
        reportPermissionScope([reportKey, ...covers.filter((key) => key !== missing)], row.report),
      ).toBeNull();
    }
  });

  it("keeps the widest report key and does not fall back to a narrower one", () => {
    expect(
      reportPermissionScope(
        ["view:report_patients:clinic", "view:report_patients:branch", "view:invoices:branch"],
        "outstanding",
      ),
    ).toBeNull();
    expect(
      reportPermissionScope(
        ["view:report_takings:branch", "view:report_takings:clinic", "view:payments:clinic"],
        "daily_takings",
      ),
    ).toBe("clinic");
  });

  it("refuses patient credit unless both keys are clinic", () => {
    expect(
      reportPermissionScope(
        ["view:report_patients:branch", "view:payments:clinic"],
        "patient_credit",
      ),
    ).toBeNull();
    expect(
      reportPermissionScope(
        ["view:report_patients:clinic", "view:payments:branch"],
        "patient_credit",
      ),
    ).toBeNull();
    expect(
      reportPermissionScope(
        ["view:report_patients:clinic", "view:payments:clinic"],
        "patient_credit",
      ),
    ).toBe("clinic");
  });

  it("requires the own report key and the own invoice key, not a wider stand-in", () => {
    expect(reportPermissionScope(["view:report_own:own", "view:invoices:own"], "own_summary")).toBe(
      "own",
    );
    for (const covering of ["branch", "clinic"] as const) {
      expect(
        reportPermissionScope(["view:report_own:own", `view:invoices:${covering}`], "own_summary"),
      ).toBeNull();
    }
    expect(
      reportPermissionScope(["view:report_patients:clinic", "view:invoices:own"], "own_summary"),
    ).toBeNull();
    expect(reportScopeSupported("by_service", "own")).toBe(false);
    expect(reportScopeSupported("patient_credit", "branch")).toBe(false);
  });
});
