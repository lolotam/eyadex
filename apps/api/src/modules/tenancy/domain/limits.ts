/** الاستهلاك الحالي مقابل الحد (مثلاً 3 من 3). */
export interface LimitUsage {
  readonly used: number;
  readonly max: number;
}

/** نتيجة فحص الحد: داخل الحد، أو هيتعدّاه مع الاستهلاك عشان الرسالة تعرضه. */
export type LimitCheck =
  | { readonly kind: "within"; readonly used: number; readonly max: number }
  | { readonly kind: "exceeded"; readonly used: number; readonly max: number };

/**
 * استهلاك حد المستخدمين (PRD §4.9): العضويات النشطة + الدعوات الـ pending اللي لسه سارية.
 * العضويات المعطّلة والدعوات الملغاة أو المقبولة أو المنتهية مش بتتحسب. العدّ نفسه بيتعمل في
 * الداتابيز عند الموديول اللي بيملك الجداول (`identity`)، عبر الـ port `SeatUsageReader` —
 * الدعوة سارية طول ما `expires_at > now` (حصري عند لحظة الانتهاء، زي db/sql/0009).
 *
 * @param activeMemberships عدد العضويات النشطة
 * @param livePendingInvitations عدد الدعوات الـ pending اللي لسه سارية
 * @param maxUsers حد العيادة `max_users`
 * @returns الاستهلاك والحد
 */
export function usersUsage(
  activeMemberships: number,
  livePendingInvitations: number,
  maxUsers: number,
): LimitUsage {
  return { used: activeMemberships + livePendingInvitations, max: maxUsers };
}

/**
 * استهلاك حد الفروع (PRD §4.9): الفروع النشطة بس.
 *
 * @param activeBranches عدد الفروع النشطة
 * @param maxBranches حد العيادة `max_branches`
 * @returns الاستهلاك والحد
 */
export function branchesUsage(activeBranches: number, maxBranches: number): LimitUsage {
  return { used: activeBranches, max: maxBranches };
}

/**
 * هل ينفع نضيف (أو نعيد تفعيل) عناصر جديدة من غير ما نعدّي الحد؟ العناصر الموجودة عمرها ما بتتأثر
 * — الفحص على الإضافة بس. الوصول للحد بالظبط مسموح (3 من 3)، تعدّيه لأ.
 *
 * @param usage الاستهلاك الحالي والحد
 * @param adding عدد العناصر المضافة، افتراضياً 1 — لازم عدد صحيح موجب
 * @returns `within` أو `exceeded` ومعاهم الاستهلاك الحالي للرسالة
 */
export function checkLimit(usage: LimitUsage, adding = 1): LimitCheck {
  if (!Number.isInteger(adding) || adding < 1) {
    throw new RangeError("adding must be a positive integer");
  }
  const kind = usage.used + adding <= usage.max ? "within" : "exceeded";
  return { kind, used: usage.used, max: usage.max };
}
