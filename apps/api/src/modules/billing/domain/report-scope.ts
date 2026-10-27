import { reportPermissionScope } from "@eyadex/contracts/finance-report-access";
import type { ReportId } from "@eyadex/contracts/finance-reports";
import type { PermissionScope } from "@eyadex/contracts/permissions";

import type { BillingActor, MemberBranches } from "./billing-actor.ts";

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
  const scope = reportPermissionScope(actor.permissions, report);
  if (scope === null) return null;
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
