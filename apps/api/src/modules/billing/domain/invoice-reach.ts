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

/** من يقدر يشوف أنهي فواتير: كل الفروع، أو فروع العضو، أو مراجعينه (`own`، R1-12). */
export type ViewReach = MemberBranches | { readonly own: string };

/**
 * نطاق عرض الفواتير: `clinic` = كل الفواتير، `branch` = فواتير فروع العضو، `own` = فواتير مراجعينه في أي
 * فرع.
 *
 * @param actor الفاعل
 * @returns النطاق، أو `null` لو مالوش `view:invoices` بأي نطاق
 */
export function viewReach(actor: BillingActor): ViewReach | null {
  if (actor.permissions.includes("view:invoices:clinic")) return { all: true };
  if (actor.permissions.includes("view:invoices:branch")) return actor.member;
  if (actor.permissions.includes("view:invoices:own")) return { own: actor.membershipId };
  return null;
}
