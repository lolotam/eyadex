/** الكلمات المحجوزة للـ subdomains بتاعة Eyadex (PRD §4.15) — نفس قايمة الـ contract. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "app",
  "platform",
  "api",
  "www",
  "admin",
  "staging",
  "staging-app",
  "staging-platform",
  "cdn",
  "mail",
  "status",
  "docs",
  "help",
  "support",
  "auth",
  "static",
  "assets",
]);

/** قرار فحص عيادة جديدة قبل أي كتابة. */
export type NewClinicCheck =
  { readonly ok: true } | { readonly ok: false; readonly code: "reserved_slug" | "validation" };

/**
 * بيفحص قواعد العيادة الجديدة اللي مش شكل بيانات: الـ slug المحجوز، وتاريخ انتهاء في المستقبل
 * (عيادة بتتعمل منتهية مالهاش معنى — الدخول مسموح بس قبل الانتهاء، PRD §4.9).
 *
 * @param slug الـ slug بعد الـ contract
 * @param expiresAt تاريخ الانتهاء
 * @param now الوقت من الـ Clock
 * @returns `ok` أو كود الخطأ
 */
export function checkNewClinic(slug: string, expiresAt: Date, now: Date): NewClinicCheck {
  if (RESERVED_SLUGS.has(slug)) return { ok: false, code: "reserved_slug" };
  if (!(expiresAt.getTime() > now.getTime())) return { ok: false, code: "validation" };
  return { ok: true };
}
