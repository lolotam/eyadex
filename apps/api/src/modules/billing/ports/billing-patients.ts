import type { Tx } from "@eyadex/db";

import type { MemberBranches } from "../domain/billing-actor.ts";

/** ملف المراجع زي ما المالية محتاجاه (بيتربط بـ adapter موديول المراجعين في `billing.module.ts`). */
export interface BillingPatientReader {
  /**
   * بيقفل صف المراجع لعملية فلوس (spec §8 rule 8): بعد قفل مالية العيادة وقبل أي فاتورة.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param patientId المراجع
   * @returns صح لو الملف موجود في العيادة
   */
  lockForInvoice(tx: Tx, clinicId: string, patientId: string): Promise<boolean>;

  /**
   * وصول الفاعل للمراجع بقواعد موديول المراجعين نفسه: `own` (موعد أو زيارة معاه) وهل الملف في نطاق عرضه.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param viewer مفاتيح الفاعل وفروعه وعضويته
   * @param patientId المراجع
   * @returns `own` و`inPatientReach`، والاتنين غلط لو الملف مش موجود
   */
  access(
    tx: Tx,
    clinicId: string,
    viewer: {
      readonly permissions: readonly string[];
      readonly member: MemberBranches;
      readonly membershipId: string;
    },
    patientId: string,
  ): Promise<{ own: boolean; inPatientReach: boolean }>;
}
