import { describe, expect, it } from "vitest";

import { auditCategory, exportAuditDetails } from "./export-audit.ts";

const branchId = "33333333-3333-4333-8333-333333333333";

describe("export audit", () => {
  it.each(["outstanding", "patient_credit", "refunds", "discounts"])(
    "marks %s as patient_access",
    (report) => {
      expect(auditCategory(report)).toBe("patient_access");
    },
  );

  it.each([
    "daily_takings",
    "period_summary",
    "by_service",
    "by_doctor",
    "cash_closings",
    "own_summary",
  ])("marks %s as administrative", (report) => {
    expect(auditCategory(report)).toBe("administrative");
  });

  it("fails closed to patient_access when the report is unknown", () => {
    expect(auditCategory("not_a_report")).toBe("patient_access");
  });

  it("keeps report, range, branch ids and row count, and drops names and reasons", () => {
    expect(
      exportAuditDetails({
        report: "refunds",
        rowCount: 2,
        params: {
          from: "2026-01-01",
          to: "2026-01-31",
          language: "ar",
          groupBy: "month",
          branchIds: [branchId],
          name: "Sara",
          reason: "discount text",
          patientName: "hidden",
        },
      }),
    ).toEqual({
      report: "refunds",
      from: "2026-01-01",
      to: "2026-01-31",
      branchIds: [branchId],
      rowCount: 2,
    });
  });

  it.each([
    null,
    [],
    { from: "2026-01-01", to: "2026-01-31" },
    { from: "2026-01-01", to: "2026-01-31", branchIds: ["not-a-uuid"] },
    { from: 1, to: "2026-01-31", branchIds: [] },
  ])("refuses incomplete params %j", (params) => {
    expect(exportAuditDetails({ report: "daily_takings", rowCount: 0, params })).toBeNull();
  });
});
