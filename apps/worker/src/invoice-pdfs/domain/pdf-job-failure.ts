/** رموز فشل PDF العامة الوحيدة المسموح بتسجيلها. */
export const PDF_FAILURE_CODES = [
  "store_unavailable",
  "db_unavailable",
  "lease_expired",
  "invalid_model",
  "size_limit",
  "cancelled",
] as const;

/** رمز فشل PDF من الكتالوج العام. */
export type PdfFailureCode = (typeof PDF_FAILURE_CODES)[number];

/** نتيجة الفشل: انتظار إعادة، أو فشل نهائي، أو إلغاء. */
export type PdfFailureOutcome = {
  status: "retry_wait" | "failed" | "cancelled";
  retryCount: number;
  delaySeconds: 30 | 120 | null;
};

/**
 * يقرر إعادة المحاولة من رمز مسموح فقط، بحد أقصى ثلاث محاولات وإعادتين.
 *
 * @param code رمز الفشل العام
 * @param current رقم المحاولة وعدد الإعادات الحالي
 * @returns الحالة التالية وعدد الإعادات وتأخيرها بالثواني
 */
export function pdfFailureOutcome(
  code: PdfFailureCode,
  current: { attempt: number; retryCount: number },
): PdfFailureOutcome {
  if (!PDF_FAILURE_CODES.includes(code)) throw new TypeError("pdf_failure_unknown");
  if (code === "cancelled")
    return { status: "cancelled", retryCount: current.retryCount, delaySeconds: null };
  const transient =
    code === "store_unavailable" || code === "db_unavailable" || code === "lease_expired";
  if (transient && current.attempt < 3 && current.retryCount < 2) {
    const retryCount = current.retryCount + 1;
    return { status: "retry_wait", retryCount, delaySeconds: retryCount === 1 ? 30 : 120 };
  }
  return { status: "failed", retryCount: current.retryCount, delaySeconds: null };
}
