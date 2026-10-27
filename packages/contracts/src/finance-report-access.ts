import type { ReportId } from "./finance-reports-rows.ts";
import { viewScopeCovers, type PermissionScope } from "./permissions.ts";

interface ReportRule {
  readonly resource: string;
  readonly covering: readonly string[];
  readonly scopes: readonly PermissionScope[];
}

/**
 * The report key and the extra keys it needs (spec §3, §4). The first scope is the widest, and a
 * wider key that is not covered does not fall back to a narrower one.
 */
const RULES: Record<ReportId, ReportRule> = {
  daily_takings: {
    resource: "report_takings",
    covering: ["payments"],
    scopes: ["clinic", "branch"],
  },
  period_summary: {
    resource: "report_takings",
    covering: ["invoices", "payments"],
    scopes: ["clinic", "branch"],
  },
  by_service: {
    resource: "report_analytics",
    covering: ["invoices"],
    scopes: ["clinic", "branch"],
  },
  by_doctor: { resource: "report_analytics", covering: ["invoices"], scopes: ["clinic", "branch"] },
  outstanding: {
    resource: "report_patients",
    covering: ["invoices"],
    scopes: ["clinic", "branch"],
  },
  patient_credit: { resource: "report_patients", covering: ["payments"], scopes: ["clinic"] },
  refunds: { resource: "report_patients", covering: ["payments"], scopes: ["clinic", "branch"] },
  discounts: { resource: "report_patients", covering: ["invoices"], scopes: ["clinic", "branch"] },
  cash_closings: {
    resource: "report_takings",
    covering: ["cash_closings"],
    scopes: ["clinic", "branch"],
  },
  own_summary: { resource: "report_own", covering: ["invoices"], scopes: ["own"] },
};

/**
 * The widest report key the caller holds, or null when that key's covering keys do not reach it.
 * An own report needs its own invoice key; a clinic or branch key does not stand in.
 */
export function reportPermissionScope(
  permissions: readonly string[],
  report: ReportId,
): PermissionScope | null {
  const rule = RULES[report];
  const scope = rule.scopes.find((candidate) =>
    permissions.includes(`view:${rule.resource}:${candidate}`),
  );
  if (scope === undefined) return null;
  const covered = rule.covering.every((resource) =>
    (["clinic", "branch", "own"] as const).some(
      (candidate) =>
        permissions.includes(`view:${resource}:${candidate}`) &&
        (scope !== "own" || candidate === "own") &&
        viewScopeCovers(candidate, scope),
    ),
  );
  return covered ? scope : null;
}

/** Whether a stored scope is one this report can be granted. Unsupported rows fail closed. */
export function reportScopeSupported(report: ReportId, scope: PermissionScope): boolean {
  return RULES[report].scopes.includes(scope);
}
