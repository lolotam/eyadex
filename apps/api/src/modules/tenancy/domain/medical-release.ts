import type { PlatformSettings } from "@eyadex/contracts/platform";

/**
 * هل الموديول الطبي اتطلق؟ بيشتغل مقفول لحد آخر شريحة (spec §9، P2-F6): ملف الإطلاق في `db/sql` بيفتح
 * الـ default للعيادات الجديدة، والـ PR بتاعه بيقلب القيمة دي لـ `true` في نفس التغيير (R3-6c).
 */
export const MEDICAL_RELEASED = false;

/**
 * هل إعدادات المنصة الجديدة مسموحة؟ قبل الإطلاق المنصة تقدر تشوف مفتاح الموديول الطبي للعيادات الجديدة،
 * لكن ماتقدرش تفتحه (R3-6c). القرار من الكود مش من القيمة المخزّنة: بعد الإطلاق المنصة ممكن تقفله
 * وترجع تفتحه.
 *
 * @param released هل الموديول الطبي اتطلق (`MEDICAL_RELEASED`)
 * @param next الإعدادات المطلوب حفظها
 * @returns `true` لو مسموحة
 */
export function medicalDefaultAllowed(released: boolean, next: PlatformSettings): boolean {
  return released || !next.defaultModules.medical;
}
