import type { ClinicModule } from "@eyadex/contracts/clinics";
import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";

const MODULE_OF: ReadonlyMap<string, ClinicModule | null> = new Map(
  PERMISSION_CATALOG.map((p) => [p.key, p.module]),
);

/** الحقول اللي القرارات محتاجاها عن دور واحد. */
export interface RoleState {
  readonly nameAr: string;
  readonly nameEn: string;
  readonly isLocked: boolean;
  readonly isActive: boolean;
  readonly permissionKeys: readonly string[];
}

/**
 * هل المفتاح ده ظاهر في محرّر الأدوار؟ مفتاح core ظاهر دايمًا؛ مفتاح موديول ظاهر بس لو الموديول
 * مفتوح للعيادة. مفتاح مش في الكتالوج مش ظاهر (زي الـ mock).
 *
 * @param key مفتاح الصلاحية
 * @param enabledModules الموديولات المفتوحة للعيادة
 * @returns `true` لو ظاهر وقابل للتعديل
 */
export function isEditableKey(key: string, enabledModules: readonly ClinicModule[]): boolean {
  const module = MODULE_OF.get(key);
  if (module === undefined) return false;
  return module === null || enabledModules.includes(module);
}

/**
 * المفاتيح اللي هتتحفظ (PRD §4.8، FLAG-02): المطلوب من المفاتيح الظاهرة، ومعاه مفاتيح الدور
 * الحالية بتاعة الموديولات المقفولة زي ما هي، مهما كان الطلب. مفتاح مطلوب لموديول مقفول بيتشال
 * بهدوء — نفس قاعدة `mergeHiddenKeys` في الـ mock.
 *
 * @param requested المفاتيح اللي في الطلب (بعد الـ contract)
 * @param existing مفاتيح الدور قبل التعديل (`[]` للإنشاء)
 * @param enabledModules الموديولات المفتوحة، مقروءة جوه transaction الكتابة
 * @returns المفاتيح النهائية، من غير تكرار ومترتبة
 */
export function mergeHiddenKeys(
  requested: readonly string[],
  existing: readonly string[],
  enabledModules: readonly ClinicModule[],
): string[] {
  const kept = existing.filter((key) => !isEditableKey(key, enabledModules));
  const asked = requested.filter((key) => isEditableKey(key, enabledModules));
  return [...new Set([...asked, ...kept])].sort();
}

/**
 * المفاتيح اللي الكتابة دي بتضيفها والفاعل نفسه مايملكهاش. TODO(spec): الـ PRD والـ mock
 * ماحددوش مين يمنح إيه؛ القراءة المتحفظة: الفاعل يضيف بس مفاتيح هو شايلها فعلًا (بعد فلترة
 * الموديولات). الحذف والإبقاء مش مقيّدين. أدمن العيادة شايل الكتالوج كله فمش متأثر.
 *
 * @param saved المفاتيح النهائية بعد `mergeHiddenKeys`
 * @param existing مفاتيح الدور قبل الكتابة
 * @param actorKeys صلاحيات الفاعل الفعلية من سياق الطلب
 * @returns المفاتيح الممنوعة، مترتبة؛ فاضية = مسموح
 */
export function keysBeyondActor(
  saved: readonly string[],
  existing: readonly string[],
  actorKeys: readonly string[],
): string[] {
  const before = new Set(existing);
  const held = new Set(actorKeys);
  return saved.filter((key) => !before.has(key) && !held.has(key)).sort();
}

/**
 * هل المجموعتين نفس المفاتيح (من غير اعتبار للترتيب أو التكرار)؟
 *
 * @param a مجموعة
 * @param b مجموعة تانية
 * @returns `true` لو نفس المفاتيح
 */
export function sameKeySet(a: readonly string[], b: readonly string[]): boolean {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((key, i) => key === y[i]);
}

/**
 * هل الكتابة مابتغيّرش حاجة؟ نفس الاسمين ونفس مجموعة المفاتيح المحفوظة.
 *
 * @param before الدور قبل
 * @param after الدور بعد
 * @returns `true` لو مفيش تغيير يتكتب أو يتسجّل
 */
export function sameRole(
  before: Pick<RoleState, "nameAr" | "nameEn" | "permissionKeys">,
  after: Pick<RoleState, "nameAr" | "nameEn" | "permissionKeys">,
): boolean {
  return (
    before.nameAr === after.nameAr &&
    before.nameEn === after.nameEn &&
    sameKeySet(before.permissionKeys, after.permissionKeys)
  );
}

/**
 * تعديل الأسماء أو المفاتيح (story 52): الدور المقفول (أدمن العيادة) مرفوض.
 *
 * @param role الدور قبل
 * @returns `locked` أو `allowed`
 */
export function decideRoleUpdate(role: Pick<RoleState, "isLocked">): "allowed" | "locked" {
  return role.isLocked ? "locked" : "allowed";
}

/**
 * تعطيل دور (story 51): المقفول مرفوض، والدور اللي عليه أعضاء (بأي حالة، زي الـ mock) مرفوض.
 *
 * @param role الدور قبل
 * @param memberCount عدد العضويات على الدور بأي حالة، متعدّ جوه قفل المستخدمين
 * @returns `locked` أو `already_inactive` أو `in_use` أو `allowed`
 */
export function decideRoleDeactivation(
  role: Pick<RoleState, "isLocked" | "isActive">,
  memberCount: number,
): "allowed" | "locked" | "already_inactive" | "in_use" {
  if (role.isLocked) return "locked";
  if (!role.isActive) return "already_inactive";
  return memberCount > 0 ? "in_use" : "allowed";
}

/**
 * إعادة تفعيل دور: المقفول مرفوض، والنشط أصلًا مفيش تغيير.
 *
 * @param role الدور قبل
 * @returns `locked` أو `already_active` أو `allowed`
 */
export function decideRoleReactivation(
  role: Pick<RoleState, "isLocked" | "isActive">,
): "allowed" | "locked" | "already_active" {
  if (role.isLocked) return "locked";
  return role.isActive ? "already_active" : "allowed";
}

/** صورة الدور في سجل التدقيق: قايمة حقول مسموحة بس. */
export interface RoleAuditSnapshot {
  readonly nameAr: string;
  readonly nameEn: string;
  readonly isActive: boolean;
  readonly permissionKeys: readonly string[];
}

/**
 * الحقول المسموحة من الدور لسجل التدقيق (AUD-01): الاسمين والحالة والمفاتيح مترتبة.
 *
 * @param role الدور
 * @returns الصورة
 */
export function roleAuditSnapshot(role: RoleAuditSnapshot): RoleAuditSnapshot {
  return {
    nameAr: role.nameAr,
    nameEn: role.nameEn,
    isActive: role.isActive,
    permissionKeys: [...role.permissionKeys].sort(),
  };
}
