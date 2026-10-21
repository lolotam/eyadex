import type { BranchOptionListResponse, OptionListQuery } from "@eyadex/contracts/role-admin";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { ApiError } from "../../../shared/errors.ts";
import type { MemberBranches } from "../domain/billing-actor.ts";
import { branchCondition } from "./branch-condition.ts";
import { fromCursor, toCursor } from "./list-cursor.ts";

interface OptionRow {
  id: string;
  name_ar: string;
  name_en: string;
  is_active: boolean;
}

/**
 * فروع العيادة اللي الفاعل يقدر يقرأ فيها مدفوعات، كاختيارات لفلتر شاشة الإيصالات (spec §4.6).
 * الفروع المعطّلة بترد كمان: إيصال فرع اتقفل بعد ما اتسجل لازم يفضل معرّف باسمه. المدى هو مدى
 * `view:payments` نفسه: `clinic` = كل فروع العيادة، `branch` = فروع العضو بس.
 *
 * @param tx الـ transaction جوه `withTenant`
 * @param clinicId عيادة السياق
 * @param reach الفروع اللي الفاعل يقدر يقرأ فيها
 * @param query الـ cursor والحد
 * @returns الصفحة والمؤشر التالي والعدد الكلي
 */
export async function listPaymentBranchOptions(
  tx: Tx,
  clinicId: string,
  reach: MemberBranches,
  query: OptionListQuery,
): Promise<BranchOptionListResponse> {
  const after = query.cursor === undefined ? null : fromCursor(query.cursor);
  // A cursor this list never made is refused, like every other list, instead of restarting at page one.
  if (query.cursor !== undefined && after === null) {
    throw new ApiError("validation", [{ path: ["cursor"], code: "invalid" }]);
  }
  const where = [sql`b.clinic_id = ${clinicId}`, branchCondition(reach, sql`b.id`)];
  // The total is counted on the whole reach, not on the page: it is the number of branches to filter by.
  const [count] = await tx.execute<{ total: number }>(
    sql`SELECT count(*)::int AS total FROM branches b WHERE ${sql.join(where, sql` AND `)}`,
  );
  const page = after === null ? where : [...where, sql`b.id > ${after}::uuid`];
  const rows = await tx.execute<OptionRow>(
    sql`SELECT b.id, b.name_ar, b.name_en, b.is_active FROM branches b
        WHERE ${sql.join(page, sql` AND `)}
        ORDER BY b.id LIMIT ${query.limit + 1}`,
  );
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return {
    items: items.map((row) => ({
      id: row.id,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      isActive: row.is_active,
    })),
    nextCursor: rows.length > query.limit && last !== undefined ? toCursor(last.id) : null,
    total: count!.total,
  };
}
