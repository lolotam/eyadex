import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/**
 * أسماء أعضاء العيادة اللي سجل التدقيق محتاجها (بحث الفاعل واسمه في الصفحة)، جوه الـ transaction
 * بتاعته. identity مالك العضويات فهي اللي بتنفّذ؛ الشكل بيطابق port السجل (`AuditMemberNameReader`)
 * من غير ما identity تستورد حاجة من السجل. كل جملة بتفلتر بـ `clinic_id` كمان فوق الـ RLS.
 */
export class PgMemberNames {
  /**
   * كل أعضاء العيادة، أي حالة (عضو اتعطّل لسه فاعل في صفوف قديمة).
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @returns الأعضاء
   */
  async allOf(tx: Tx, clinicId: string): Promise<readonly { userId: string; fullName: string }[]> {
    const rows = await tx.execute<{ user_id: string; full_name: string }>(
      sql`SELECT user_id, full_name FROM memberships WHERE clinic_id = ${clinicId}`,
    );
    return rows.map((row) => ({ userId: row.user_id, fullName: row.full_name }));
  }

  /**
   * أسماء مجموعة فاعلين في جملة واحدة.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param userIds الفاعلين
   * @returns الاسم لكل فاعل عضو في العيادة
   */
  async namesOf(
    tx: Tx,
    clinicId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    // A JSON list, not an array parameter: tx.execute sends every parameter as text.
    const rows = await tx.execute<{ user_id: string; full_name: string }>(
      sql`SELECT user_id, full_name FROM memberships WHERE clinic_id = ${clinicId}
          AND user_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(unique)}::jsonb))`,
    );
    return new Map(rows.map((row) => [row.user_id, row.full_name]));
  }
}
