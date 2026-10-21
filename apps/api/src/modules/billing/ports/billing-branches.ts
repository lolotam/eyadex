import type { Tx } from "@eyadex/db";

/** فروع العيادة زي ما المالية محتاجاه (tenancy بتنفّذ `PgFilingBranches`، والربط في `billing.module.ts`). */
export interface BillingBranchReader {
  /**
   * كل فروع العيادة، المعطّلة منهم كمان: إيصال فرع اتقفل بعد ما اتسجل لازم يفضل معرّف باسمه.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param language لغة ترتيب الأسماء (المالية بترتّب بالـ id بعدها)
   * @returns الفروع بمعرّفاتها واسماتها وحالتها
   */
  listForOptions(
    tx: Tx,
    clinicId: string,
    language: "ar" | "en",
  ): Promise<readonly { id: string; nameAr: string; nameEn: string; isActive: boolean }[]>;
}
