import type { Tx } from "@eyadex/db";

export interface BillingReportServices {
  /**
   * أسماء الخدمات اللي ظهرت في التقرير، بما فيها الخدمات المتوقفة.
   * @param tx معاملة العيادة
   * @param clinicId العيادة
   * @param serviceIds معرّفات الخدمات في صفوف التقرير
   * @returns الاسمين لكل خدمة موجودة
   */
  namesOf(
    tx: Tx,
    clinicId: string,
    serviceIds: readonly string[],
  ): Promise<ReadonlyMap<string, { readonly nameAr: string; readonly nameEn: string }>>;
}
