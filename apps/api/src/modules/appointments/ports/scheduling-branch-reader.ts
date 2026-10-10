import type { Tx } from "@eyadex/db";

/** فرع في جدول مقدّم خدمة. */
export interface SchedulingBranch {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly isActive: boolean;
}

/**
 * اللي موديول المواعيد محتاجه من جدول الفروع (ملك tenancy). tenancy بتنفّذه (`PgFilingBranches`، نفس
 * adapter المراجعين)، والربط في `appointments.module.ts`.
 */
export interface SchedulingBranchReader {
  /**
   * الفرع مقفول `FOR SHARE` لحد آخر الـ transaction، فتعطيله في نفس اللحظة بيستنى.
   *
   * @param tx transaction المواعيد جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param branchId الفرع
   * @returns هل الفرع نشط، أو `null` لو مش فرع في العيادة دي
   */
  lockForFiling(tx: Tx, clinicId: string, branchId: string): Promise<{ isActive: boolean } | null>;

  /**
   * كل فروع العيادة: النشطة الأول، وبعدين بالاسم في لغة المستخدم.
   *
   * @param tx transaction المواعيد جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param language لغة ترتيب الأسماء
   * @returns الفروع
   */
  listForOptions(
    tx: Tx,
    clinicId: string,
    language: "ar" | "en",
  ): Promise<readonly SchedulingBranch[]>;
}
