import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/**
 * أسماء الأدوار اللي لقطات سجل التدقيق بتشاور عليها، جوه الـ transaction بتاعته. identity مالك
 * الأدوار فهي اللي بتنفّذ؛ الشكل بيطابق port السجل (`AuditRefNameReader`) من غير ما identity تستورد
 * حاجة من السجل. على pool المنصة بيستخدم الـ SELECT اللي عندها أصلاً على `roles` (0013).
 */
export class PgRoleNames {
  /**
   * أسماء أدوار في جملة واحدة.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param roleIds الأدوار
   * @returns الاسمين لكل دور موجود في العيادة
   */
  async namesOf(
    tx: Tx,
    clinicId: string,
    roleIds: readonly string[],
  ): Promise<ReadonlyMap<string, { nameAr: string; nameEn: string }>> {
    const unique = [...new Set(roleIds)];
    if (unique.length === 0) return new Map();
    // A JSON list, not an array parameter: tx.execute sends every parameter as text.
    const rows = await tx.execute<{ id: string; name_ar: string; name_en: string }>(
      sql`SELECT id, name_ar, name_en FROM roles WHERE clinic_id = ${clinicId}
          AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(unique)}::jsonb))`,
    );
    return new Map(rows.map((row) => [row.id, { nameAr: row.name_ar, nameEn: row.name_en }]));
  }
}
