import type { PermissionKey } from "@eyadex/contracts/permissions";

/**
 * النطاق اللي الصلاحية اتمنحت بيه: `clinic` = كل الفروع، `branch` = فروع المستخدم، `own` = سجلاته بس
 * (spec المواعيد §3؛ تقييمه في الاستعلامات بييجي في A3).
 */
export type PermissionGrant = "clinic" | "branch" | "own";

/**
 * هل المفاتيح دي بتدي الصلاحية المطلوبة؟ الأوسع على نفس الفعل والمورد بيكسب دايمًا: `clinic` ثم
 * `branch` ثم `own`. مطلوب `clinic` ما بيعدّيش إلا بمفتاح `clinic`؛ مطلوب `branch` بيعدّي بـ `clinic` أو
 * `branch`؛ مطلوب `own` بيعدّي بأي واحد من التلاتة. مفيش أي فحص على اسم الدور أو مفتاحه.
 *
 * @param permissions مفاتيح الدور الفعلية
 * @param required المفتاح اللي الـ route طالبه
 * @returns النطاق الممنوح، أو `null` = مرفوض
 */
export function grantFor(
  permissions: readonly string[],
  required: PermissionKey,
): PermissionGrant | null {
  const [action, resource, scope] = required.split(":");
  if (permissions.includes(`${action}:${resource}:clinic`)) return "clinic";
  if (scope === "clinic") return null;
  if (permissions.includes(`${action}:${resource}:branch`)) return "branch";
  if (scope === "own" && permissions.includes(required)) return "own";
  return null;
}
