import type { ReportId } from "@eyadex/contracts/finance-reports";
import { viewScopeCovers, type PermissionScope } from "@eyadex/contracts/permissions";
import type { Persona } from "@eyadex/contracts/session";
import type { z } from "zod";
import { ApiError } from "../api-error";
import { guardFinance, type FinanceAccess } from "./mock-finance-access";
import { clinicFinanceOf, exponentOf } from "./mock-finance-state";
import type { MockState } from "./mock-store";

// The API's report access (finance-reports.controller.ts, report-scope.ts, reports.ts), in its order:
// the guard (active user → clinic access → finance) → the route's one key → the query (a range over
// 366 days is `report_range_too_long`) → the report scope and its covering keys → the branch filter.

const ROUTE_KEY: Record<ReportId, string> = {
  daily_takings: "view:report_takings:branch",
  period_summary: "view:report_takings:branch",
  by_service: "view:report_analytics:branch",
  by_doctor: "view:report_analytics:branch",
  outstanding: "view:report_patients:branch",
  patient_credit: "view:report_patients:clinic",
  refunds: "view:report_patients:branch",
  discounts: "view:report_patients:branch",
  cash_closings: "view:report_takings:branch",
  own_summary: "view:report_own:own",
};

const RULES: Record<ReportId, { resource: string; covering: readonly string[] }> = {
  daily_takings: { resource: "report_takings", covering: ["payments"] },
  period_summary: { resource: "report_takings", covering: ["invoices", "payments"] },
  by_service: { resource: "report_analytics", covering: ["invoices"] },
  by_doctor: { resource: "report_analytics", covering: ["invoices"] },
  outstanding: { resource: "report_patients", covering: ["invoices"] },
  patient_credit: { resource: "report_patients", covering: ["payments"] },
  refunds: { resource: "report_patients", covering: ["payments"] },
  discounts: { resource: "report_patients", covering: ["invoices"] },
  cash_closings: { resource: "report_takings", covering: ["cash_closings"] },
  own_summary: { resource: "report_own", covering: ["invoices"] },
};

/** The guard's `grantFor`: a wider key stands in for a narrower route key. */
export function grantFor(keys: readonly string[], required: string): boolean {
  const [action, resource, scope] = required.split(":");
  if (keys.includes(`${action}:${resource}:clinic`)) return true;
  if (scope === "clinic") return false;
  if (keys.includes(`${action}:${resource}:branch`)) return true;
  return scope === "own" && keys.includes(required);
}

/** `reportScope`: the widest report key decides the scope; every covering key must reach it. */
export function reportScope(keys: readonly string[], report: ReportId): PermissionScope | null {
  const rule = RULES[report];
  const scopes: PermissionScope[] =
    report === "own_summary"
      ? ["own"]
      : report === "patient_credit"
        ? ["clinic"]
        : ["clinic", "branch"];
  const scope = scopes.find((s) => keys.includes(`view:${rule.resource}:${s}`));
  if (scope === undefined) return null;
  const covered = rule.covering.every((resource) =>
    (["clinic", "branch", "own"] as const).some(
      (s) =>
        keys.includes(`view:${resource}:${s}`) &&
        (scope !== "own" || s === "own") &&
        viewScopeCovers(s, scope),
    ),
  );
  return covered ? scope : null;
}

/** The API's `ZodValidationPipe`: a too-long range is its own code, anything else `validation`. */
export function parseReportQuery<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (parsed.error.issues.some((i) => i.message === "validation.rangeTooLong")) {
    throw new ApiError("report_range_too_long");
  }
  throw new ApiError("validation");
}

export type ReportContext = {
  db: MockState;
  access: FinanceAccess;
  clinicId: string;
  /** Every branch the report may read, inactive ones included at clinic scope. */
  branchIds: readonly string[];
  branchNames: ReadonlyMap<string, string>;
  language: "ar" | "en";
  timeZone: string;
  facts: { currency: ReturnType<typeof clinicFinanceOf>["currency"]; currencyExponent: number };
};

/** Opens a report in the API's order and gives its reach, or refuses. */
export function openReport<S extends z.ZodTypeAny>(
  db: MockState,
  persona: Persona,
  report: ReportId,
  schema: S,
  raw: unknown,
): { ctx: ReportContext; query: z.infer<S> } {
  const access = guardFinance(db, persona);
  if (!grantFor(access.keys, ROUTE_KEY[report])) throw new ApiError("forbidden");
  const query = parseReportQuery(schema, raw) as z.infer<S> & { branchId?: string };
  const scope = reportScope(access.keys, report);
  if (scope === null) throw new ApiError("forbidden");
  const clinicId = access.clinic.id;
  const language = access.member.preferredLanguage === "ar" ? "ar" : "en";
  const branches = db.branches.filter((b) => b.clinicId === clinicId);
  const all = scope !== "branch" || access.branches.allBranches;
  const reach = branches
    .map((b) => b.id)
    .filter((id) => all || access.branches.branchIds.includes(id));
  if (query.branchId !== undefined && !reach.includes(query.branchId)) {
    throw new ApiError("forbidden");
  }
  const finance = clinicFinanceOf(db, clinicId);
  return {
    query,
    ctx: {
      db,
      access,
      clinicId,
      branchIds: query.branchId === undefined ? reach : [query.branchId],
      branchNames: new Map(
        branches.map((b) => [b.id, language === "ar" ? b.nameAr : b.nameEn] as const),
      ),
      language,
      timeZone: access.clinic.timezone,
      facts: { currency: finance.currency, currencyExponent: exponentOf(finance.currency) },
    },
  };
}
