/** أقل مسافة بين رسالتين واتساب لنفس العيادة (spec §7.1). */
export const PACE_MS = 8_000;
/** أقصى زيادة عشوائية فوق المسافة، عشان الإرسال مايبقاش منتظم زي البوت. */
export const JITTER_MS = 4_000;

/**
 * هل دور العيادة في الإرسال جه؟ لو `next_send_at` لسه في المستقبل، الرسالة تستنى لحد الوقت ده — وده تأجيل
 * مش محاولة فاشلة، فمابيتحسبش من المحاولات.
 *
 * @param nextSendAt `clinic_whatsapp_channels.next_send_at`، أو `null` لو العيادة لسه مابعتتش
 * @param now الوقت من الـ Clock
 * @returns الوقت اللي تستنى له، أو `null` لو تبعت دلوقتي
 */
export function paceWait(nextSendAt: Date | null, now: Date): Date | null {
  return nextSendAt !== null && nextSendAt.getTime() > now.getTime() ? nextSendAt : null;
}

/**
 * أول وقت مسموح فيه بالرسالة الجاية بعد إرسال: `now + 8s + (0..4s)`.
 *
 * @param now وقت الإرسال
 * @param random عشوائي متحقن في `[0, 1)` (`Math.random` في main.ts، ثابت في الاختبارات)
 * @returns `next_send_at` الجديد
 */
export function nextSendAt(now: Date, random: () => number): Date {
  const jitter = Math.min(Math.max(random(), 0), 1) * JITTER_MS;
  return new Date(now.getTime() + PACE_MS + Math.round(jitter));
}
