import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** رأس فاتورة المالية؛ tenancy يملك العيادات والفروع، ولا يقرأ أي بيانات مراجعين. */
export class PgBillingPdfHeader {
  /**
   * يقرأ بيانات الطباعة للعيادة والفرع داخل سياق RLS نفسه.
   * @param tx معاملة العيادة
   * @param clinicId العيادة
   * @param branchId فرع الفاتورة
   * @returns حقول الرأس المسموحة أو null عند غياب السجل
   */
  async read(tx: Tx, clinicId: string, branchId: string) {
    const [row] = await tx.execute<{
      clinicAr: string;
      clinicEn: string;
      timezone: string;
      address: string | null;
      phone: string | null;
    }>(sql`SELECT c.name_ar AS "clinicAr", c.name_en AS "clinicEn", c.timezone,
      b.address, b.phone FROM clinics c JOIN branches b ON b.clinic_id = c.id
      WHERE c.id = ${clinicId} AND b.id = ${branchId} AND b.clinic_id = ${clinicId}`);
    return row ?? null;
  }
}
