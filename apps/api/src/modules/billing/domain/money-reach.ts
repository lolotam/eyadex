import type { BillingActor, MemberBranches } from "./billing-actor.ts";

/**
 * الفروع اللي الفاعل يقدر يشوف فيها دفعاته أو يسجّل فيها دفعة: `clinic` = كل الفروع، `branch` = فروعه،
 * غير كده مفيش. نطاق الدفعة هو فرع فاتورتها (F2-Q8): الفلوس بتتسجل دايمًا في فرع الفاتورة، مش فرع
 * الموظف اللي استلم.
 *
 * @param actor الفاعل
 * @param action الفعل (`view` أو `create`)
 * @returns الفروع، أو `null` لو مالوش المفتاح بأي نطاق فروع
 */
export function paymentsReach(
  actor: BillingActor,
  action: "view" | "create",
): MemberBranches | null {
  return keyReach(actor, action, "payments");
}

/**
 * الفروع اللي الفاعل يقدر يعمل فيها استرداد: نطاق الاسترداد هو فرع الفاتورة اللي اتعمل منها (F2-Q8).
 * مفيش `view:refunds`: الاسترداد بيتقري بمفتاح `view:payments` (spec §4.1).
 *
 * @param actor الفاعل
 * @returns الفروع، أو `null` لو مالوش `create:refunds` بأي نطاق فروع
 */
export function refundsReach(actor: BillingActor): MemberBranches | null {
  return keyReach(actor, "create", "refunds");
}

/**
 * الفروع اللي الفاعل يقدر يشوف إقفالات صندوقها أو يقفل صندوقها: نطاق الإقفال هو فرعه (spec §4.1).
 *
 * @param actor الفاعل
 * @param action الفعل (`view` أو `create`)
 * @returns الفروع، أو `null` لو مالوش المفتاح بأي نطاق فروع
 */
export function cashClosingsReach(
  actor: BillingActor,
  action: "view" | "create",
): MemberBranches | null {
  return keyReach(actor, action, "cash_closings");
}

/** `clinic` = كل الفروع، `branch` = فروع العضو، غير كده مفيش. */
function keyReach(
  actor: BillingActor,
  action: "view" | "create",
  resource: "payments" | "refunds" | "cash_closings",
): MemberBranches | null {
  if (actor.permissions.includes(`${action}:${resource}:clinic`)) return { all: true };
  if (actor.permissions.includes(`${action}:${resource}:branch`)) return actor.member;
  return null;
}
