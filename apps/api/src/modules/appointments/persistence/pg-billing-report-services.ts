import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** أسماء الخدمات لتقارير المالية؛ الربط بالـ port في billing.module.ts بس. */
export class PgBillingReportServices {
  async namesOf(
    tx: Tx,
    clinicId: string,
    serviceIds: readonly string[],
  ): Promise<ReadonlyMap<string, { readonly nameAr: string; readonly nameEn: string }>> {
    const ids = [...new Set(serviceIds)];
    if (ids.length === 0) return new Map();
    const rows = await tx.execute<{ id: string; name_ar: string; name_en: string }>(sql`
      SELECT id, name_ar, name_en FROM clinic_services WHERE clinic_id = ${clinicId}
        AND id = ANY(string_to_array(${ids.join(",")}, ',')::uuid[])`);
    return new Map(rows.map((row) => [row.id, { nameAr: row.name_ar, nameEn: row.name_en }]));
  }
}
