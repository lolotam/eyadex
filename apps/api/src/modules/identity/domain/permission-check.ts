import type { PermissionKey } from "@eyadex/contracts/permissions";

/** النطاق اللي الصلاحية اتمنحت بيه: `clinic` = كل الفروع، `branch` = فروع المستخدم بس. */
export type PermissionGrant = "clinic" | "branch";

/**
 * هل المفاتيح دي بتدي الصلاحية المطلوبة؟ المفتاح نفسه بيكفي. مطلوب `branch` بيعدّي كمان بنفس
 * الفعل والمورد بنطاق `clinic` (أوسع). مطلوب `clinic` ما بيعدّيش أبدًا بمفتاح `branch`. مفيش أي فحص
 * على اسم الدور أو مفتاحه.
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
  const clinicKey = `${action}:${resource}:clinic`;
  if (permissions.includes(clinicKey)) return "clinic";
  if (scope === "branch" && permissions.includes(required)) return "branch";
  return null;
}
