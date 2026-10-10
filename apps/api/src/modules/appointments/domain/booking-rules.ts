import type { SlotProblem } from "@eyadex/contracts/appointment-slots";
import type { AppointmentStatus, CancelReason } from "@eyadex/contracts/appointments";
import { canTransition } from "@eyadex/contracts/appointments";
import { scrubAuditText } from "@eyadex/observability";

import { reachCovers, type Reach } from "./scheduling-scope.ts";

/** أفعال الكتابة على المواعيد: ليها `clinic` و `branch` بس، مفيش `own` (spec §3). */
export type WriteAction = "create" | "update" | "overbook";

/**
 * وصول فعل كتابة على المواعيد من مفاتيح الفاعل الفعلية: مفتاح `clinic` = كل الفروع، مفتاح `branch` =
 * فروع العضو، غير كده مفيش فروع. نفس شكل `viewReachOf` بتاع الجداول.
 *
 * @param permissions مفاتيح الفاعل الفعلية (بعد الموديولات المقفولة)
 * @param action الفعل
 * @param member فروع العضو من سياق الطلب
 * @returns الوصول (فاضي لو مفيش مفتاح)
 */
export function appointmentReach(
  permissions: readonly string[],
  action: WriteAction,
  member: Reach,
): Reach {
  if (permissions.includes(`${action}:appointments:clinic`)) return { all: true };
  if (permissions.includes(`${action}:appointments:branch`)) return member;
  return { all: false, branchIds: [] };
}

/** وصول العرض: فروع (`clinic` أو `branch`)، أو مواعيد الفاعل نفسه بس في أي فرع (`own`، A3). */
export type ViewReach = Reach | { readonly own: string };

/**
 * وصول العرض من مفاتيح الفاعل الفعلية، الأوسع يكسب (PRD §4.7): `clinic` = كل الفروع، `branch` = فروع
 * العضو، `own` = المواعيد اللي مقدّم الخدمة فيها هو عضوية الفاعل، غير كده مفيش حاجة.
 *
 * @param permissions مفاتيح الفاعل الفعلية
 * @param member فروع العضو من سياق الطلب
 * @param membershipId عضوية الفاعل
 * @returns وصول العرض
 */
export function appointmentViewReach(
  permissions: readonly string[],
  member: Reach,
  membershipId: string,
): ViewReach {
  if (permissions.includes("view:appointments:clinic")) return { all: true };
  if (permissions.includes("view:appointments:branch")) return member;
  if (permissions.includes("view:appointments:own")) return { own: membershipId };
  return { all: false, branchIds: [] };
}

/**
 * الفروع اللي الفاعل يقدر يفتح يومها: وصول الفروع زي ما هو، وتحت `own` فروع عضويته هو (TODO(spec) 2
 * في ADR-0026 A3)، واليوم بيوريه عموده هو بس.
 *
 * @param view وصول العرض
 * @param member فروع العضو
 * @returns الفروع
 */
export function dayBranches(view: ViewReach, member: Reach): Reach {
  return "own" in view ? member : view;
}

/**
 * هل وصول العرض بيشوف الموعد ده؟ بالفرع، أو تحت `own` لما مقدّم الخدمة يكون الفاعل نفسه.
 *
 * @param view وصول العرض
 * @param row فرع الموعد ومقدّم الخدمة
 * @returns `true` لو ظاهر
 */
export function viewSees(
  view: ViewReach,
  row: { readonly branchId: string; readonly providerMembershipId: string },
): boolean {
  if ("own" in view) return row.providerMembershipId === view.own;
  return reachCovers(view, row.branchId);
}

/** فاعل على المواعيد: عيادته وعضويته، مفاتيحه الفعلية، فروعه، منطقة العيادة الزمنية ولغته. */
export interface AppointmentActor {
  readonly clinicId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly timezone: string;
  readonly language: "ar" | "en";
  readonly permissions: readonly string[];
  readonly member: Reach;
}

/**
 * وصول الفاعل لفعل كتابة على المواعيد.
 *
 * @param actor الفاعل
 * @param action الفعل
 * @returns الوصول
 */
export function actorReach(actor: AppointmentActor, action: WriteAction): Reach {
  return appointmentReach(actor.permissions, action, actor.member);
}

/**
 * وصول العرض للفاعل (الأوسع يكسب).
 *
 * @param actor الفاعل
 * @returns وصول العرض
 */
export function actorViewReach(actor: AppointmentActor): ViewReach {
  return appointmentViewReach(actor.permissions, actor.member, actor.membershipId);
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
