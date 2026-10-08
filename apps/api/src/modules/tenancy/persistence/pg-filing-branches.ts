import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/**
 * قراية الفروع اللي موديول المراجعين محتاجها، جوه الـ transaction بتاعته. tenancy مالك جدول الفروع
 * فهي اللي بتنفّذ؛ الشكل بيطابق port المراجعين (`PatientBranchReader`) من غير ما tenancy تستورد حاجة
 * من المراجعين (tenancy مابتستوردش أي موديول، CLAUDE.architecture.md §2.2). كل جملة بتفلتر بـ
 * `clinic_id` كمان فوق الـ RLS.
 */
export class PgFilingBranches {
  /**
   * فرع التسجيل مقفول `FOR SHARE`: تعطيل الفرع بالتوازي بيستنى الـ transaction دي.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param branchId الفرع
   * @returns هل الفرع نشط، أو `null`
   */
  async lockForFiling(
    tx: Tx,
    clinicId: string,
    branchId: string,
  ): Promise<{ isActive: boolean } | null> {
    const rows = await tx.execute<{ is_active: boolean }>(
      sql`SELECT is_active FROM branches WHERE clinic_id = ${clinicId} AND id = ${branchId} FOR SHARE`,
    );
    return rows[0] === undefined ? null : { isActive: rows[0].is_active };
  }

  /**
   * أسماء فروع في جملة واحدة.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param branchIds الفروع
   * @returns الاسمين لكل فرع موجود
   */
  async namesOf(
    tx: Tx,
    clinicId: string,
    branchIds: readonly string[],
  ): Promise<ReadonlyMap<string, { nameAr: string; nameEn: string }>> {
    const unique = [...new Set(branchIds)];
    if (unique.length === 0) return new Map();
    const rows = await tx.execute<{ id: string; name_ar: string; name_en: string }>(
      sql`SELECT id, name_ar, name_en FROM branches WHERE clinic_id = ${clinicId}
          AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(unique)}::jsonb))`,
    );
    return new Map(rows.map((row) => [row.id, { nameAr: row.name_ar, nameEn: row.name_en }]));
  }
}
