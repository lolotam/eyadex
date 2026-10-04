/** الموديولات اللي ليها flag (db/sql/0002) — المراجعون بس دلوقتي. */
export type ClinicModule = "patients";

/** صف flag واحد للعيادة. */
export interface FeatureFlag {
  readonly module: ClinicModule;
  readonly enabled: boolean;
}

/**
 * هل الموديول مفعّل للعيادة (PRD §4.8)؟ موديول مالوش صف بيعتبر مقفول (default deny).
 * TODO(spec): الـ PRD مابيقولش صراحة إيه حكم العيادة اللي مالهاش صف للموديول؛ الـ onboarding
 * المفروض يكتب الصف دايماً، فالرفض هنا أأمن اختيار لحد ما يتأكد.
 *
 * @param flags صفوف `clinic_features` بتاعة العيادة
 * @param module الموديول المطلوب
 * @returns `true` لو فيه صف مفعّل للموديول
 */
export function isModuleEnabled(flags: readonly FeatureFlag[], module: ClinicModule): boolean {
  return flags.some((flag) => flag.module === module && flag.enabled);
}
