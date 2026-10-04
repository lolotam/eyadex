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
