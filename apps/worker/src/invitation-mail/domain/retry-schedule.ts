const MINUTE = 60_000;

/** المهلة بعد الفشل رقم n (من 1). الفشل الخامس هو آخر واحد: بعده الحدث بيتقفل `failed_at`. */
export const RETRY_DELAYS_MS: readonly number[] = [
  MINUTE,
  5 * MINUTE,
  30 * MINUTE,
  120 * MINUTE,
  360 * MINUTE,
];
export const MAX_FAILURES = 5;

/** إيه اللي يحصل بعد فشل إرسال. */
export type FailureStep =
  { readonly kind: "retry"; readonly nextAttemptAt: Date } | { readonly kind: "give_up" };

/**
 * بيحسب الخطوة بعد فشل: محاولة تانية بعد المهلة، أو الاستسلام عند الفشل الخامس.
 *
 * @param previousFailures عدد المحاولات اللي فشلت قبل دي (`outbox_events.attempts`)
 * @param now وقت الفشل
 * @returns الخطوة الجاية
 */
export function afterFailure(previousFailures: number, now: Date): FailureStep {
  const failure = previousFailures + 1;
  if (failure >= MAX_FAILURES) return { kind: "give_up" };
  const delay = RETRY_DELAYS_MS[failure - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
  return { kind: "retry", nextAttemptAt: new Date(now.getTime() + delay) };
}
