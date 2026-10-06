/** الفرع من زاوية قاعدة التعطيل. */
export interface BranchState {
  readonly id: string;
  readonly isActive: boolean;
}

/** نتيجة طلب تعطيل فرع. */
export type BranchDeactivation = "allowed" | "last_active_branch" | "already_inactive";

/**
 * قاعدة OD-7: العيادة لازم تفضل بفرع نشط واحد على الأقل، فتعطيل آخر فرع نشط مرفوض.
 * فرع معطّل أصلاً بيرجع `already_inactive` عشان الـ use case يقرر (مفيش تغيير يتكتب).
 *
 * @param target الفرع المطلوب تعطيله
 * @param activeBranches عدد الفروع النشطة في العيادة دلوقتي (شامل الفرع ده لو نشط)
 * @returns `allowed` أو `last_active_branch` أو `already_inactive`
 */
export function decideBranchDeactivation(
  target: BranchState,
  activeBranches: number,
): BranchDeactivation {
  if (!target.isActive) return "already_inactive";
  if (activeBranches <= 1) return "last_active_branch";
  return "allowed";
}

/** نتيجة طلب إعادة تفعيل فرع. */
export type BranchReactivation = "allowed" | "already_active" | "limit_reached";

/**
 * إعادة التفعيل بتتحسب على حد الفروع زي الإنشاء بالظبط (PRD §4.9): فرع راجع = فرع نشط زيادة.
 * فرع نشط أصلاً بيرجع `already_active` (مفيش تغيير يتكتب، ولا يتحسب على الحد).
 *
 * @param target الفرع المطلوب تفعيله
 * @param activeBranches عدد الفروع النشطة دلوقتي
 * @param maxBranches حد العيادة
 * @returns `allowed` أو `already_active` أو `limit_reached`
 */
export function decideBranchReactivation(
  target: BranchState,
  activeBranches: number,
  maxBranches: number,
): BranchReactivation {
  if (target.isActive) return "already_active";
  return activeBranches + 1 <= maxBranches ? "allowed" : "limit_reached";
}

/** الحقول اللي ممكن تظهر في before/after بتاع سجل العيادة لفرع (PRD §4.11). */
export interface BranchAuditSnapshot {
  readonly nameAr: string;
  readonly nameEn: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly isActive: boolean;
}

/**
 * قايمة الحقول المسموحة لسجل الفرع: بتاخد الحقول دي بس، فأي عمود جديد مايتسربش للسجل لوحده.
 *
 * @param branch الفرع (أي object فيه الحقول دي على الأقل)
 * @returns الحقول المسموحة بس
 */
export function branchAuditSnapshot(branch: BranchAuditSnapshot): BranchAuditSnapshot {
  return {
    nameAr: branch.nameAr,
    nameEn: branch.nameEn,
    address: branch.address,
    phone: branch.phone,
    isActive: branch.isActive,
  };
}
