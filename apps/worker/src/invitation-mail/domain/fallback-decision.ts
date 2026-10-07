export type FallbackDecision = "try_secondary" | "retry_primary";

const DEFINITIVE = /^resend_5\d\d(?::|$)/;

/**
 * بيقرر بعد فشل Resend (ADR-0014): نجرب SMTP المنصة بس لو Resend أكيد ما استلمش الرسالة — 5xx أو
 * الطلب ما وصلش أصلاً. أي timeout أو خطأ شبكة غامض أو 4xx (حتى 429) → نعيد Resend في معاده، لأن
 * SMTP ما عندوش مفتاح idempotency والبديل ممكن يبعت مرتين.
 *
 * @param primaryError كود خطأ المزود الأساسي
 * @returns `try_secondary` أو `retry_primary`
 */
export function decideFallback(primaryError: string): FallbackDecision {
  if (primaryError === "resend_unreachable" || DEFINITIVE.test(primaryError)) {
    return "try_secondary";
  }
  return "retry_primary";
}
