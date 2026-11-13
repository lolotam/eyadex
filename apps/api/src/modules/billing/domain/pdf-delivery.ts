/**
 * قرار انتهاء الاشتراك بعد الرسم؛ الإيقاف أو بلوغ وقت الانتهاء يمنع التسليم.
 * @param status حالة العيادة
 * @param expiresAt وقت انتهاء الاشتراك
 * @param now الوقت الحالي المحقون
 * @returns true إذا كان الاشتراك يمنع التسليم
 */
export function pdfSubscriptionBlocked(status: string, expiresAt: string, now: Date): boolean {
  return status === "suspended" || pdfLinkExpired(expiresAt, now);
}

/**
 * يفحص حد الانتهاء الحصري للرابط أو الاشتراك بالوقت المحقون.
 * @param expiresAt وقت الانتهاء المخزن
 * @param now الوقت الحالي المحقون
 * @returns true عند بلوغ الانتهاء أو تجاوزه
 */
export function pdfLinkExpired(expiresAt: string, now: Date): boolean {
  return Date.parse(expiresAt) <= now.getTime();
}
