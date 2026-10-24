import type { Tx } from "@eyadex/db";

export interface BillingReportStaff {
  /**
   * الأسماء هنا بمعرّفات العضويات، مش معرّفات حسابات الدخول، وتشمل العضويات المتوقفة.
   * @param tx معاملة العيادة
   * @param clinicId العيادة
   * @param membershipIds عضويات صفوف التقرير
   * @returns الأسماء الموجودة فقط، من غير بيانات دخول
   */
  findMany(
    tx: Tx,
    clinicId: string,
    membershipIds: readonly string[],
  ): Promise<ReadonlyMap<string, { readonly fullName: string }>>;
}
