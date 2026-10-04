/** حالة الاشتراك المخزّنة على العيادة (db/sql/0001). "منتهي" مش حالة مخزّنة — بتتحسب. */
export type ClinicStatus = "trial" | "active" | "suspended";

/** نتيجة قرار الدخول: مسموح، أو موقوفة، أو منتهية. */
export type ClinicAccess = "allowed" | "suspended" | "expired";

/** اللي القرار محتاجه من العيادة بس. */
export interface ClinicSubscription {
  readonly status: ClinicStatus;
  readonly expiresAt: Date;
}

/**
 * يقرر هل العيادة مسموح لها بالدخول دلوقتي (PRD §4.9، CLAUDE.architecture.md §3 الطبقة 2).
 * الإيقاف بيغلب الانتهاء: عيادة موقوفة ومنتهية ترجع `suspended`. الانتهاء **حصري عند اللحظة
 * نفسها**: لو `now` يساوي `expiresAt` بالظبط فالعيادة منتهية — الدخول مسموح فقط لما
 * `now < expiresAt`، زي `expires_at > now()` في الـ SQL.
 *
 * @param subscription حالة العيادة وتاريخ انتهائها
 * @param now الوقت الحالي من الـ Clock المحقون
 * @returns `allowed` أو `suspended` أو `expired`
 */
export function decideClinicAccess(subscription: ClinicSubscription, now: Date): ClinicAccess {
  if (subscription.status === "suspended") return "suspended";
  if (now.getTime() >= subscription.expiresAt.getTime()) return "expired";
  return "allowed";
}
