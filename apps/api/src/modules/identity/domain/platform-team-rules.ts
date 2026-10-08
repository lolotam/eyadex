/** حالة حساب في فريق المنصة (0037). */
export type PlatformAccountState = "invited" | "active" | "deactivated";

/** اللي القواعد محتاجاه من الحساب. */
export interface PlatformAccountFacts {
  readonly status: PlatformAccountState;
  /** اتملا لما الحساب قبل الدعوة؛ `null` = عمره ما انضم. */
  readonly joinedAt: Date | null;
  /** انتهاء الرابط المعلّق؛ `null` = مفيش رابط. */
  readonly linkExpiresAt: Date | null;
}

/** صلاحية رابط الدعوة بالأيام (OD-3، زي دعوات العيادة). */
export const PLATFORM_INVITE_TTL_DAYS = 7;

/**
 * قرار التعطيل (ADM-02): المعطّل أصلاً مفيش تغيير؛ آخر حساب نشط مايتعطلش؛ غير كده يتعطّل.
 *
 * @param account الحساب
 * @param otherActive عدد الحسابات النشطة التانية، متعدّ تحت قفل الفريق
 * @returns `noop` أو `refuse` أو `deactivate`
 */
export function decideDeactivation(
  account: Pick<PlatformAccountFacts, "status">,
  otherActive: number,
): "noop" | "refuse" | "deactivate" {
  if (account.status === "deactivated") return "noop";
  if (account.status === "active" && otherActive === 0) return "refuse";
  return "deactivate";
}

/**
 * الحالة بعد إعادة التفعيل: اللي انضم قبل كده يرجع نشط، واللي لسه ماانضمش يرجع مدعو.
 *
 * @param account الحساب
 * @returns الحالة الجديدة، أو `null` لو مش معطّل (مفيش تغيير)
 */
export function reactivatedState(
  account: Pick<PlatformAccountFacts, "status" | "joinedAt">,
): PlatformAccountState | null {
  if (account.status !== "deactivated") return null;
  return account.joinedAt === null ? "invited" : "active";
}

/**
 * قرار الدعوة لإيميل: جديد، أو رابط جديد لحساب لسه مدعو، أو الإيميل مأخوذ.
 *
 * @param existing حساب الفريق بنفس الإيميل، أو `null`
 * @returns `new` أو `reissue` أو `email_taken`
 */
export function decideInvite(
  existing: Pick<PlatformAccountFacts, "status"> | null,
): "new" | "reissue" | "email_taken" {
  if (existing === null) return "new";
  return existing.status === "invited" ? "reissue" : "email_taken";
}

/**
 * هل الرابط المعلّق لسه ينفع يتقبل دلوقتي؟ الحساب مدعو والرابط ماانتهاش (حصري عند اللحظة نفسها).
 *
 * @param account الحساب
 * @param now الوقت من الـ Clock، بعد القفل
 * @returns `true` لو ينفع
 */
export function invitationUsable(
  account: Pick<PlatformAccountFacts, "status" | "linkExpiresAt">,
  now: Date,
): boolean {
  return (
    account.status === "invited" &&
    account.linkExpiresAt !== null &&
    account.linkExpiresAt.getTime() > now.getTime()
  );
}

/**
 * انتهاء رابط جديد من دلوقتي.
 *
 * @param now الوقت من الـ Clock
 * @returns اللحظة بعد `PLATFORM_INVITE_TTL_DAYS` يوم
 */
export function platformInviteExpiry(now: Date): Date {
  return new Date(now.getTime() + PLATFORM_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}
