import type { BillingActor, MemberBranches } from "./billing-actor.ts";

/**
 * الفروع اللي الفاعل يقدر يعمل فيها فعل على الفواتير: `clinic` = كل الفروع، `branch` = فروعه، غير كده
 * مفيش (المفتاح `own` بيتقري من مراجعين الفاعل، مش من الفروع).
 *
 * @param actor الفاعل
 * @param action الفعل (`create` أو `update` أو `deactivate`)
 * @returns الفروع، أو `null` لو مالوش المفتاح بأي نطاق فروع
 */
export function branchReach(
  actor: BillingActor,
  action: "create" | "update" | "deactivate",
): MemberBranches | null {
  if (actor.permissions.includes(`${action}:invoices:clinic`)) return { all: true };
  if (actor.permissions.includes(`${action}:invoices:branch`)) return actor.member;
  return null;
}

/**
 * الفرع جوه الفروع دي.
 *
 * @param reach الفروع
 * @param branchId الفرع
 * @returns صح لو جواها
 */
export const reachesBranch = (reach: MemberBranches, branchId: string): boolean =>
  reach.all || reach.branchIds.includes(branchId);
