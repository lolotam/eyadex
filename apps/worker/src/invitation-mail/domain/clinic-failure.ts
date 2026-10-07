/** عدد الإخفاقات الأكيدة المتتالية اللي بعدها مزود العيادة بيتحوّل للمنصة (ADR-0014، 7c-2b). */
export const DEGRADE_AFTER = 3;

const SMTP_DEFINITIVE = new Set([
  "smtp_econnrefused",
  "smtp_econnection",
  "smtp_econnreset",
  "smtp_ehostunreach",
  "smtp_enetunreach",
  "smtp_auth",
  "smtp_dns",
  "smtp_blocked_address",
  "smtp_port_not_allowed",
]);

const OTHER_DEFINITIVE = new Set(["resend_unreachable", "seal_unreadable"]);

/**
 * فشل مزود العيادة أكيد (بيتحسب في التحويل للمنصة) ولا غامض؟ الأكيد: Resend 5xx أو ما وصلش، مفتاح
 * اتلغى (401/403)، أخطاء اتصال SMTP، المصادقة، SMTP 5xx، DNS، عنوان أو منفذ ممنوع، أو ختم مايتفتحش.
 * الـ timeout وأي خطأ تاني غامض بيتعاد بس مابيتحسبش.
 *
 * @param error كود الخطأ القصير
 * @returns `true` لو بيتحسب
 */
export function isDefinitiveClinicFailure(error: string): boolean {
  if (OTHER_DEFINITIVE.has(error) || SMTP_DEFINITIVE.has(error)) return true;
  // Resend may append `:<name>` to any status (a revoked key can be `resend_401:validation_error`);
  // SMTP is a bare response code.
  return /^resend_(?:5\d\d|401|403)(?::|$)/.test(error) || /^smtp_5\d\d$/.test(error);
}

/** الخطوة بعد فشل أكيد: العداد الجديد، وهل المزود بيتحوّل دلوقتي. */
export interface FailureStep {
  readonly failures: number;
  readonly degrade: boolean;
}

/**
 * بيزوّد العداد بعد فشل أكيد، وبيقرر التحويل لما يوصل `DEGRADE_AFTER`.
 *
 * @param consecutiveFailures العداد الحالي على الصف
 * @returns العداد الجديد وهل نحوّل
 */
export function afterDefinitiveFailure(consecutiveFailures: number): FailureStep {
  const failures = consecutiveFailures + 1;
  return { failures, degrade: failures >= DEGRADE_AFTER };
}
