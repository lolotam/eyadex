import { moduleSchema, type ClinicModule } from "@eyadex/contracts/clinics";

/** الموديولات اللي ليها flag (db/sql/0002، 0042): قايمة الـ contract الوحيدة. */
export type { ClinicModule };

/** صف flag واحد للعيادة. */
export interface FeatureFlag {
  readonly module: ClinicModule;
  readonly enabled: boolean;
}

/**
 * هل الموديول مفعّل للعيادة (PRD §4.8)؟ موديول مالوش صف بيعتبر مقفول (default deny، ADR-0010):
 * الـ onboarding بيكتب صف لكل موديول دايمًا، فصف ناقص معناه بيانات ناقصة، والرفض هو الأأمن.
 *
 * @param flags صفوف `clinic_features` بتاعة العيادة
 * @param module الموديول المطلوب
 * @returns `true` لو فيه صف مفعّل للموديول
 */
export function isModuleEnabled(flags: readonly FeatureFlag[], module: ClinicModule): boolean {
  return flags.some((flag) => flag.module === module && flag.enabled);
}

/**
 * خريطة الموديولات كلها (موديول → مفعّل؟) من صفوف الـ flags، بنفس قاعدة `isModuleEnabled`.
 *
 * @param flags صفوف `clinic_features` بتاعة العيادة
 * @returns لكل موديول في `moduleSchema` هل هو مفعّل
 */
export function moduleMap(flags: readonly FeatureFlag[]): Record<ClinicModule, boolean> {
  return Object.fromEntries(
    moduleSchema.options.map((module) => [module, isModuleEnabled(flags, module)]),
  ) as Record<ClinicModule, boolean>;
}
