import type { SlotProblem } from "@eyadex/contracts/appointment-slots";
import type { AppointmentStatus, CancelReason } from "@eyadex/contracts/appointments";
import { canTransition } from "@eyadex/contracts/appointments";
import { scrubAuditText } from "@eyadex/observability";

import type { Reach } from "./scheduling-scope.ts";

/**
 * وصول فعل على المواعيد من مفاتيح الفاعل الفعلية: مفتاح `clinic` = كل الفروع، مفتاح `branch` = فروع
 * العضو، غير كده مفيش فروع (`own` بييجي في A3). نفس شكل `viewReachOf` بتاع الجداول.
 *
 * @param permissions مفاتيح الفاعل الفعلية (بعد الموديولات المقفولة)
 * @param action الفعل
 * @param member فروع العضو من سياق الطلب
 * @returns الوصول (فاضي لو مفيش مفتاح)
 */
export function appointmentReach(
  permissions: readonly string[],
  action: "view" | "create" | "update" | "overbook",
  member: Reach,
): Reach {
  if (permissions.includes(`${action}:appointments:clinic`)) return { all: true };
  if (permissions.includes(`${action}:appointments:branch`)) return member;
  return { all: false, branchIds: [] };
}

/** فاعل على المواعيد: عيادته، مفاتيحه الفعلية، فروعه، منطقة العيادة الزمنية ولغته. */
export interface AppointmentActor {
  readonly clinicId: string;
  readonly userId: string;
  readonly timezone: string;
  readonly language: "ar" | "en";
  readonly permissions: readonly string[];
  readonly member: Reach;
}

/**
 * وصول الفاعل لفعل على المواعيد.
 *
 * @param actor الفاعل
 * @param action الفعل
 * @returns الوصول
 */
export function actorReach(
  actor: AppointmentActor,
  action: "view" | "create" | "update" | "overbook",
): Reach {
  return appointmentReach(actor.permissions, action, actor.member);
}

/** قرار قاعدة 2: مسموح (وعلامة الحجز الإضافي) أو أول مشكلة. */
export type SlotDecision =
  | { readonly kind: "ok"; readonly overbooked: boolean }
  | { readonly kind: "refused"; readonly code: SlotProblem };

/**
 * D-3، D-6: الحجز الإضافي بيشيل فحوص قاعدة 2 التلاتة بس (ساعات العمل، الإجازة، التداخل)، والموعد بيتعلّم
 * `overbooked` لما يكون فحص منهم فعلاً اتشال. من غيره أول مشكلة هي الرد.
 *
 * @param problems مشاكل الوقت بالترتيب (`appointmentSlotProblems`)
 * @param overbook الفاعل طلب الحجز الإضافي وماسك مفتاحه في الفرع ده
 * @returns القرار
 */
export function decideSlot(problems: readonly SlotProblem[], overbook: boolean): SlotDecision {
  const first = problems[0];
  if (first === undefined) return { kind: "ok", overbooked: false };
  if (overbook) return { kind: "ok", overbooked: true };
  return { kind: "refused", code: first };
}

/**
 * D-5: نفس الحالة = مفيش تغيير (من غير صف سجل)، نقلة من الجدول = تتعمل، غير كده `invalid_transition`.
 *
 * @param from الحالة الحالية
 * @param to الحالة المطلوبة
 * @returns `same` أو `move` أو `invalid`
 */
export function decideTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): "same" | "move" | "invalid" {
  if (from === to) return "same";
  return canTransition(from, to) ? "move" : "invalid";
}

/** حقول الموعد اللي ممكن تتسجّل في السجل الإداري. */
export interface AppointmentAuditFields {
  readonly providerName: string;
  readonly branchId: string;
  readonly serviceNameAr: string | null;
  readonly serviceNameEn: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: AppointmentStatus;
  readonly overbooked: boolean;
  readonly cancelReason: CancelReason | null;
}

/**
 * لقطة الموعد في السجل الإداري (قاعدة 9): حقائق الحجز بس. مفيش اسم مراجع ولا تليفونه ولا رقمه المدني
 * ولا ملاحظة الإلغاء (نص حر)، والأسماء المكتوبة بإيد بتعدّي على `scrubAuditText`.
 *
 * @param a حقول الموعد
 * @returns اللقطة
 */
export function appointmentAuditSnapshot(a: AppointmentAuditFields): Record<string, unknown> {
  return {
    providerName: scrubAuditText(a.providerName),
    branchId: a.branchId,
    serviceNameAr: a.serviceNameAr === null ? null : scrubAuditText(a.serviceNameAr),
    serviceNameEn: a.serviceNameEn === null ? null : scrubAuditText(a.serviceNameEn),
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    status: a.status,
    overbooked: a.overbooked,
    cancelReason: a.cancelReason,
  };
}
