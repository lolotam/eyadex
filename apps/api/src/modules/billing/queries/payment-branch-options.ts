import type { BranchOptionListResponse, OptionListQuery } from "@eyadex/contracts/role-admin";
import type { Tx } from "@eyadex/db";

import { ApiError } from "../../../shared/errors.ts";
import type { MemberBranches } from "../domain/billing-actor.ts";
import type { BillingBranchReader } from "../ports/billing-branches.ts";
import { fromCursor, toCursor } from "./list-cursor.ts";

/**
 * فروع العيادة اللي الفاعل يقدر يقرأ فيها مدفوعات، كاختيارات لفلتر شاشة الإيصالات (spec §4.6).
 * الفروع المعطّلة بترد كمان: إيصال فرع اتقفل بعد ما اتسجل لازم يفضل معرّف باسمه. المدى هو مدى
 * `view:payments` نفسه: `clinic` = كل فروع العيادة، `branch` = فروع العضو بس.
 *
 * @param tx الـ transaction جوه `withTenant`
 * @param clinicId عيادة السياق
 * @param reach الفروع اللي الفاعل يقدر يقرأ فيها
 * @param query الـ cursor والحد
 * @param branches قارئ الفروع (port بتنفّذه tenancy)
 * @returns الصفحة والمؤشر التالي والعدد الكلي
 */
export async function listPaymentBranchOptions(
  tx: Tx,
  clinicId: string,
  reach: MemberBranches,
  query: OptionListQuery,
  branches: BillingBranchReader,
): Promise<BranchOptionListResponse> {
  const after = query.cursor === undefined ? null : fromCursor(query.cursor);
  // A cursor that is not in this list's format is refused; a well-formed id only sets the position,
  // as in every other billing list (payment-list.ts, refund-list.ts).
  if (query.cursor !== undefined && after === null) {
    throw new ApiError("validation", [{ path: ["cursor"], code: "invalid" }]);
  }
  // A clinic's branch count is bounded by its plan limit, so the whole list is small and it pages in memory.
  const all = await branches.listForOptions(tx, clinicId, "ar");
  const allowedIds = reach.all ? null : new Set(reach.branchIds);
  // The cursor is the last id seen, so the list is sorted by id ascending.
  const kept = all
    .filter((branch) => allowedIds === null || allowedIds.has(branch.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rest = after === null ? kept : kept.filter((branch) => branch.id > after);
  const page = rest.slice(0, query.limit + 1);
  const items = page.slice(0, query.limit);
  const last = items.at(-1);
  return {
    items: items.map((branch) => ({
      id: branch.id,
      nameAr: branch.nameAr,
      nameEn: branch.nameEn,
      isActive: branch.isActive,
    })),
    nextCursor: page.length > query.limit && last !== undefined ? toCursor(last.id) : null,
    total: kept.length,
  };
}
