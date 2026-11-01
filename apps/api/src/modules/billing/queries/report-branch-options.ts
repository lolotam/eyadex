import type { BranchOptionListResponse, OptionListQuery } from "@eyadex/contracts/role-admin";
import type { Tx } from "@eyadex/db";

import { ApiError } from "../../../shared/errors.ts";
import { reportBranchIds, type ReportScope } from "../domain/report-scope.ts";
import type { BillingBranchReader } from "../ports/billing-branches.ts";
import { fromCursor, toCursor } from "./list-cursor.ts";

/**
 * أسماء فروع التقرير بنفس مدى قبول التصدير؛ الفرع المتوقف داخل المدى يفضل ظاهرًا للتاريخ المالي.
 * @param tx معاملة عيادة السياق
 * @param clinicId العيادة المعتمدة من الحارس
 * @param reach نطاق التقرير بعد مفتاحه ومفاتيح تغطيته
 * @param query صفحة الخيارات
 * @param branches قارئ tenancy الموجود، من غير قراءة جداولها هنا
 * @returns الأسماء والحالة داخل المدى فقط، بمؤشر مرتب بالمعرّف
 */
export async function listReportBranchOptions(
  tx: Tx,
  clinicId: string,
  reach: ReportScope,
  query: OptionListQuery,
  branches: BillingBranchReader,
): Promise<BranchOptionListResponse> {
  const after = query.cursor === undefined ? null : fromCursor(query.cursor);
  if (query.cursor !== undefined && after === null)
    throw new ApiError("validation", [{ path: ["cursor"], code: "invalid" }]);
  const all = await branches.listForOptions(tx, clinicId, "ar");
  const ids = reportBranchIds(
    reach,
    all.map((branch) => branch.id),
  );
  if (ids === null) throw new ApiError("forbidden");
  const allowed = new Set(ids);
  const kept = all
    .filter((branch) => allowed.has(branch.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const rest = after === null ? kept : kept.filter((branch) => branch.id > after);
  const items = rest.slice(0, query.limit);
  const last = items.at(-1);
  return {
    items: items.map(({ id, nameAr, nameEn, isActive }) => ({ id, nameAr, nameEn, isActive })),
    nextCursor: rest.length > query.limit && last !== undefined ? toCursor(last.id) : null,
    total: kept.length,
  };
}
