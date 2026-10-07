import { maskPhonesInText } from "@eyadex/observability";

/** حالة دعوة وقت القرار، كما اتقرت بعد الأقفال. */
export interface InvitationCandidate {
  readonly id: string;
  readonly status: "pending" | "accepted" | "cancelled";
  readonly allBranches: boolean;
  /** عدد فروع الدعوة اللي لسه نشطة. */
  readonly activeBranchCount: number;
}

/**
 * القاعدة (ADR-0012 §16): تتلغي الدعوة لو معلّقة، ومش على كل الفروع، ومفيش ولا فرع من فروعها نشط.
 * الفرع اللي اتعطّل مش جزء من القاعدة: فرع رجع نشط قبل التنفيذ معناه مفيش إلغاء.
 *
 * @param candidate حالة الدعوة
 * @returns `true` لو لازم تتلغي
 */
export function isOrphaned(candidate: InvitationCandidate): boolean {
  return (
    candidate.status === "pending" && !candidate.allBranches && candidate.activeBranchCount === 0
  );
}

/** حقول الدعوة اللي بتدخل سجل العيادة، نفس شكل الإلغاء اليدوي. */
export interface InvitationAuditFields {
  readonly fullName: string;
  readonly email: string;
  readonly roleId: string;
  readonly roleNameAr: string;
  readonly roleNameEn: string;
  readonly allBranches: boolean;
  readonly branchIds: readonly string[];
  readonly expiresAt: Date;
}

/**
 * لقطة before/after بنفس قايمة الإلغاء اليدوي؛ الأسماء بتتعدّى على `maskPhonesInText` عشان رقم
 * تليفون مكتوب في اسم مايوصلش للسجل.
 *
 * @param fields حقول الدعوة
 * @param status الحالة في اللقطة (`pending`/`expired` قبل، `cancelled` بعد)
 * @returns اللقطة
 */
export function invitationSnapshot(
  fields: InvitationAuditFields,
  status: "pending" | "expired" | "cancelled",
) {
  return {
    fullName: maskPhonesInText(fields.fullName),
    email: fields.email,
    roleId: fields.roleId,
    roleNameAr: maskPhonesInText(fields.roleNameAr),
    roleNameEn: maskPhonesInText(fields.roleNameEn),
    allBranches: fields.allBranches,
    branchIds: [...fields.branchIds].sort(),
    status,
    expiresAt: fields.expiresAt.toISOString(),
  };
}

/**
 * الحالة المعروضة قبل الإلغاء: "منتهية" محسوبة مش متخزّنة.
 *
 * @param expiresAt انتهاء الدعوة
 * @param now وقت القرار
 * @returns `expired` أو `pending`
 */
export function shownStatus(expiresAt: Date, now: Date): "pending" | "expired" {
  return expiresAt.getTime() <= now.getTime() ? "expired" : "pending";
}
