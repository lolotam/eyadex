import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

type NameRow = { id: string; name_ar: string; name_en: string };

/**
 * اللي سجل التدقيق محتاجه من جدول العيادات (المنطقة الزمنية والأسماء)، جوه الـ transaction بتاعته.
 * tenancy مالك العيادات فهي اللي بتنفّذ؛ الشكل بيطابق port السجل (`AuditClinicReader`) من غير ما
 * tenancy تستورد أي موديول (CLAUDE.architecture.md §2.2). الظهور بيقرره الـ RLS: عيادة السياق على
 * `eyadex_app`، وكل العيادات على `eyadex_platform` (`clinics_platform_all`).
 */
export class PgClinicNames {
  /**
   * المنطقة الزمنية للعيادة.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @returns اسم المنطقة، أو `null` لو العيادة مش ظاهرة
   */
  async timeZoneOf(tx: Tx, clinicId: string): Promise<string | null> {
    const rows = await tx.execute<{ timezone: string }>(
      sql`SELECT timezone FROM clinics WHERE id = ${clinicId}`,
    );
    return rows[0]?.timezone ?? null;
  }

  /**
   * أسماء مجموعة عيادات في جملة واحدة.
   *
   * @param tx الـ transaction
   * @param clinicIds العيادات
   * @returns الاسمين لكل عيادة ظاهرة
   */
  async namesOf(
    tx: Tx,
    clinicIds: readonly string[],
  ): Promise<ReadonlyMap<string, { nameAr: string; nameEn: string }>> {
    const unique = [...new Set(clinicIds)];
    if (unique.length === 0) return new Map();
    // A JSON list, not an array parameter: tx.execute sends every parameter as text.
    const rows = await tx.execute<NameRow>(
      sql`SELECT id, name_ar, name_en FROM clinics
          WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(unique)}::jsonb))`,
    );
    return new Map(rows.map((row) => [row.id, { nameAr: row.name_ar, nameEn: row.name_en }]));
  }

  /**
   * كل العيادات الظاهرة بالاسمين، مرتبة بالاسم الإنجليزي ثم الـ id.
   *
   * @param tx الـ transaction
   * @returns العيادات
   */
  async listOptions(tx: Tx): Promise<readonly { id: string; nameAr: string; nameEn: string }[]> {
    const rows = await tx.execute<NameRow>(
      sql`SELECT id, name_ar, name_en FROM clinics ORDER BY name_en, id`,
    );
    return rows.map((row) => ({ id: row.id, nameAr: row.name_ar, nameEn: row.name_en }));
  }
}
