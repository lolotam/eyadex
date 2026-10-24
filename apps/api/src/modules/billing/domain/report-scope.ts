import type { ReportId } from "@eyadex/contracts/finance-reports";
import { viewScopeCovers, type PermissionScope } from "@eyadex/contracts/permissions";

import type { BillingActor, MemberBranches } from "./billing-actor.ts";

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

export interface ReportScope {
  readonly scope: PermissionScope;
  readonly branches: MemberBranches;
}

/**
 * التقرير ما يوسعش صلاحية البيانات الأصلية؛ أوسع مفتاح تقرير هو اللي بيحدد التغطية المطلوبة.
 * `own` محتاج مفتاح الفواتير نفسه، لأن ترتيب النطاقات العام مش بديل لملكية المراجعين هنا.
 * @param actor الفاعل بمفاتيحه وفروعه
 * @param report التقرير المطلوب
 * @returns النطاق وفروعه أو `null` لو مفتاح التقرير أو التغطية ناقص
 */
export function reportScope(actor: BillingActor, report: ReportId): ReportScope | null {
  const rule = RULES[report];
  const scopes: PermissionScope[] =
    report === "own_summary"
      ? ["own"]
      : report === "patient_credit"
        ? ["clinic"]
        : ["clinic", "branch"];
  const scope = scopes.find((s) => actor.permissions.includes(`view:${rule.resource}:${s}`));
  if (scope === undefined) return null;
  const covered = rule.covering.every((resource) =>
    (["clinic", "branch", "own"] as const).some(
      (s) =>
        actor.permissions.includes(`view:${resource}:${s}`) &&
        (scope !== "own" || s === "own") &&
        viewScopeCovers(s, scope),
    ),
  );
  if (!covered) return null;
  return { scope, branches: scope === "branch" ? actor.member : { all: true } };
}

/**
 * دوال SQL ما بتفسرش `NULL` على إنه كل الفروع؛ لازم قايمة صريحة، حتى للفروع المتوقفة.
 * @param reach النطاق اللي اجتاز مفاتيح التقرير
 * @param clinicBranchIds كل فروع العيادة، بما فيها المتوقفة
 * @param branchId فلتر اختياري لازم يكون داخل النطاق
 * @returns الفروع أو `null` لو الفلتر خارج النطاق
 */
export function reportBranchIds(
  reach: ReportScope,
  clinicBranchIds: readonly string[],
  branchId?: string,
): readonly string[] | null {
  const ids = reach.branches.all
    ? clinicBranchIds
    : clinicBranchIds.filter((id) => reach.branches.all || reach.branches.branchIds.includes(id));
  if (branchId === undefined) return ids;
  return ids.includes(branchId) ? [branchId] : null;
}
