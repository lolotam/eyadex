import type { Tx } from "@eyadex/db";

/** اسم فرع بالعربي والإنجليزي. */
export interface MedicalBranchNames {
  readonly nameAr: string;
  readonly nameEn: string;
}

/** فرع في قايمة اختيارات. */
export interface MedicalBranchOption extends MedicalBranchNames {
  readonly id: string;
  readonly isActive: boolean;
}

/**
 * اللي موديول الطب محتاجه من جدول الفروع (ملك tenancy). tenancy بتنفّذه (`PgFilingBranches`)، والربط في
 * `medical.module.ts`.
 */
export interface MedicalBranchReader {
  /**
   * الفرع مقفول `FOR SHARE` (آخر صف في ترتيب أقفال بداية الزيارة، ADR-0027).
   *
   * @param tx transaction الطب جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param branchId الفرع
   * @returns هل الفرع نشط، أو `null`
   */
  lockForFiling(tx: Tx, clinicId: string, branchId: string): Promise<{ isActive: boolean } | null>;

  /**
   * أسماء فروع في جملة واحدة.
   *
   * @param tx transaction الطب
   * @param clinicId العيادة
   * @param branchIds الفروع
   * @returns الاسمين لكل فرع موجود
   */
  namesOf(
    tx: Tx,
    clinicId: string,
    branchIds: readonly string[],
  ): Promise<ReadonlyMap<string, MedicalBranchNames>>;

  /**
   * كل فروع العيادة: النشطة الأول، وبعدين بالاسم في لغة المستخدم.
   *
   * @param tx transaction الطب
   * @param clinicId العيادة
   * @param language لغة الترتيب
   * @returns الفروع
   */
  listForOptions(
    tx: Tx,
    clinicId: string,
    language: "ar" | "en",
  ): Promise<readonly MedicalBranchOption[]>;
}
