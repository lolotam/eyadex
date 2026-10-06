import type { SystemRoleKey } from "./system-roles.ts";

/** مفتاح دور أدمن العيادة: الأدمن بيتعرف بمفتاح النظام بتاع دوره، عمره ما بيتعرف بالاسم. */
export const CLINIC_ADMIN_KEY: SystemRoleKey = "clinic_admin";

/** حالة العضو اللي القرارات محتاجاها. */
export interface MemberState {
  readonly status: "active" | "deactivated";
  readonly roleSystemKey: string | null;
}

/**
 * هل العضو ده أدمن نشط؟
 *
 * @param member العضو
 * @returns `true` لو نشط ودوره مفتاحه `clinic_admin`
 */
export function isActiveAdmin(member: MemberState): boolean {
  return member.status === "active" && member.roleSystemKey === CLINIC_ADMIN_KEY;
}

/**
 * تعطيل عضو (ADM-01): آخر أدمن نشط ممنوع.
 *
 * @param member العضو قبل التغيير
 * @param activeAdmins عدد الأدمنز النشطين دلوقتي (جوه قفل المستخدمين)
 * @returns `already_inactive` أو `last_active_admin` أو `allowed`
 */
export function decideMemberDeactivation(
  member: MemberState,
  activeAdmins: number,
): "allowed" | "already_inactive" | "last_active_admin" {
  if (member.status === "deactivated") return "already_inactive";
  if (isActiveAdmin(member) && activeAdmins <= 1) return "last_active_admin";
  return "allowed";
}

/**
 * تغيير دور عضو (ADM-01): نقل آخر أدمن نشط لدور تاني ممنوع.
 *
 * @param member العضو قبل التغيير
 * @param currentRoleId دوره الحالي
 * @param target الدور الجديد (الـ id ومفتاح النظام)
 * @param activeAdmins عدد الأدمنز النشطين
 * @returns `same` أو `last_active_admin` أو `allowed`
 */
export function decideRoleChange(
  member: MemberState,
  currentRoleId: string,
  target: { readonly id: string; readonly systemKey: string | null },
  activeAdmins: number,
): "allowed" | "same" | "last_active_admin" {
  if (target.id === currentRoleId) return "same";
  const demotes = isActiveAdmin(member) && target.systemKey !== CLINIC_ADMIN_KEY;
  return demotes && activeAdmins <= 1 ? "last_active_admin" : "allowed";
}

/** الحالة المخزّنة للدعوة. */
export type StoredInvitationStatus = "pending" | "accepted" | "cancelled";

/**
 * إلغاء دعوة: pending (حتى لو منتهية) بتتلغي، الملغاة no-op، المقبولة مرفوضة.
 *
 * @param status الحالة المخزّنة
 * @returns `allowed` أو `already_cancelled` أو `accepted`
 */
export function decideInvitationCancel(
  status: StoredInvitationStatus,
): "allowed" | "already_cancelled" | "accepted" {
  if (status === "cancelled") return "already_cancelled";
  return status === "accepted" ? "accepted" : "allowed";
}

/**
 * إعادة إرسال دعوة: pending بس. لو منتهية، هترجع تاخد مقعد، فلازم فحص الحد.
 *
 * @param status الحالة المخزّنة
 * @param expiresAt انتهاء الدعوة
 * @param now الوقت من الـ Clock
 * @returns `not_pending` أو `reoccupies_seat` (منتهية) أو `keeps_seat` (لسه سارية)
 */
export function decideInvitationResend(
  status: StoredInvitationStatus,
  expiresAt: Date,
  now: Date,
): "not_pending" | "reoccupies_seat" | "keeps_seat" {
  if (status !== "pending") return "not_pending";
  return expiresAt.getTime() <= now.getTime() ? "reoccupies_seat" : "keeps_seat";
}

/**
 * هل قايمتين فروع نفس المجموعة؟
 *
 * @param a الأولى
 * @param b التانية
 * @returns `true` لو نفس العناصر من غير ترتيب
 */
export function sameBranchSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/** الحقول المسموحة في سجل العيادة لعضو أو دعوة (AUD-01). مفيش رمز ولا hash ولا تليفون. */
export interface PersonAuditSnapshot {
  readonly fullName: string;
  readonly email: string;
  readonly roleId: string;
  readonly roleNameAr: string;
  readonly roleNameEn: string;
  readonly allBranches: boolean;
  readonly branchIds: readonly string[];
  readonly status: string;
  readonly expiresAt?: string;
}

/**
 * بيبني الـ snapshot من قايمة الحقول المسموحة بس، مهما كان الكائن فيه إيه تاني.
 *
 * @param person العضو أو الدعوة
 * @returns الحقول المسموحة
 */
export function personAuditSnapshot(person: PersonAuditSnapshot): PersonAuditSnapshot {
  return {
    fullName: person.fullName,
    email: person.email,
    roleId: person.roleId,
    roleNameAr: person.roleNameAr,
    roleNameEn: person.roleNameEn,
    allBranches: person.allBranches,
    branchIds: [...person.branchIds].sort(),
    status: person.status,
    ...(person.expiresAt === undefined ? {} : { expiresAt: person.expiresAt }),
  };
}
