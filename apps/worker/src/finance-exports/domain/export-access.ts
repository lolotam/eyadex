import {
  reportPermissionScope,
  reportScopeSupported,
} from "@eyadex/contracts/finance-report-access";
import type { ReportId } from "@eyadex/contracts/finance-reports";
import { viewScopeCovers, type PermissionScope } from "@eyadex/contracts/permissions";

/** لقطة حالية من غير أسماء ولا مفاتيح جلسة. الانتهاء حصري: `observedUs < expiresUs`. */
export interface ExportAccessSnapshot {
  readonly userId: string;
  readonly membershipActive: boolean;
  readonly roleActive: boolean;
  readonly clinicStatus: string;
  readonly expiresUs: string;
  readonly observedUs: string;
  readonly financeEnabled: boolean;
  readonly permissions: readonly string[];
  readonly allBranches: boolean;
  readonly activeAssignedBranchIds: readonly string[];
  readonly clinicBranchIds: readonly string[];
}

/** قرار التفويض قبل قراءة صفوف التقرير. مش تفويض مرضى `own`. */
export type ExportAccessDecision =
  { readonly kind: "ready"; readonly userId: string } | { readonly kind: "forbidden" };

/**
 * يعيد اشتقاق النطاق الحالي ويقارنه بالسقف المخزّن. السقف مش منحة: نطاق أوسع ما يبدّلش
 * الفروع المجمّدة، ونطاق أضيق أو فرع ضائع يرفض. `own` لازم يكون `own` نفسه.
 *
 * @param input التقرير والسقف المخزّن والفروع المجمّدة واللقطة الحالية
 * @returns جاهز بمعرّف المستخدم، أو رفض
 */
export function decideExportAccess(input: {
  readonly report: ReportId;
  readonly storedScope: PermissionScope;
  readonly branchIds: readonly string[];
  readonly snapshot: ExportAccessSnapshot | null;
}): ExportAccessDecision {
  const snapshot = input.snapshot;
  if (snapshot === null || snapshot.userId === "") return { kind: "forbidden" };
  if (!snapshot.membershipActive || !snapshot.roleActive) return { kind: "forbidden" };
  if (!clinicOpen(snapshot) || !snapshot.financeEnabled) return { kind: "forbidden" };
  if (!reportScopeSupported(input.report, input.storedScope)) return { kind: "forbidden" };
  const current = reportPermissionScope(snapshot.permissions, input.report);
  if (current === null) return { kind: "forbidden" };
  if (input.storedScope === "own" && current !== "own") return { kind: "forbidden" };
  if (!viewScopeCovers(current, input.storedScope)) return { kind: "forbidden" };
  const reach = reachableBranches(snapshot, current);
  if (input.branchIds.some((id) => !reach.has(id))) return { kind: "forbidden" };
  return { kind: "ready", userId: snapshot.userId };
}

function clinicOpen(snapshot: ExportAccessSnapshot): boolean {
  if (snapshot.clinicStatus !== "trial" && snapshot.clinicStatus !== "active") return false;
  return BigInt(snapshot.observedUs) < BigInt(snapshot.expiresUs);
}

function reachableBranches(
  snapshot: ExportAccessSnapshot,
  current: PermissionScope,
): ReadonlySet<string> {
  if (current !== "branch" || snapshot.allBranches) return new Set(snapshot.clinicBranchIds);
  const owned = new Set(snapshot.clinicBranchIds);
  return new Set(snapshot.activeAssignedBranchIds.filter((id) => owned.has(id)));
}
