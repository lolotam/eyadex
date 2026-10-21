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
  if (actor.permissions.includes(`${action}:payments:clinic`)) return { all: true };
  if (actor.permissions.includes(`${action}:payments:branch`)) return actor.member;
  return null;
}
