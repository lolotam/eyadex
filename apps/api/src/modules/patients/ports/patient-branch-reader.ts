import type { Tx } from "@eyadex/db";

/** اسم فرع بالعربي والإنجليزي، للعرض جنب الملف. */
export interface BranchNames {
  readonly nameAr: string;
  readonly nameEn: string;
}

/** فرع في قايمة اختيارات المراجعين (تسجيل أو فلترة). */
export interface PatientBranchOption extends BranchNames {
  readonly id: string;
  readonly isActive: boolean;
}

/**
 * اللي موديول المراجعين محتاجه من جدول الفروع (ملك tenancy)، جوه transaction المراجعين نفسها. الـ port
 * ده بتاع المراجعين، و tenancy هي اللي بتنفّذه (`PgFilingBranches`)، فمفيش موديول بيقرا جدول موديول
 * تاني مباشرة (apps/api/AGENTS.md).
 */
export interface PatientBranchReader {
  /**
   * فرع التسجيل لملف بيتعمل أو بيتنقل، مقفول `FOR SHARE` لحد آخر الـ transaction، فتعطيل الفرع في
   * نفس اللحظة بيستنى.
   *
   * @param tx transaction المراجعين جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param branchId الفرع
   * @returns هل الفرع نشط، أو `null` لو مش فرع في العيادة دي
   */
  lockForFiling(tx: Tx, clinicId: string, branchId: string): Promise<{ isActive: boolean } | null>;

  /**
   * أسماء مجموعة فروع في نداء واحد (صفحة كاملة من الملفات، من غير N+1).
   *
   * @param tx transaction المراجعين جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param branchIds الفروع (التكرار مسموح)
   * @returns الاسم لكل فرع موجود في العيادة
   */
  namesOf(
    tx: Tx,
    clinicId: string,
    branchIds: readonly string[],
  ): Promise<ReadonlyMap<string, BranchNames>>;

  /**
   * كل فروع العيادة لقايمة الاختيارات: النشطة الأول، وبعدين بالاسم في لغة المستخدم. المتعطلة بتفضل
   * ظاهرة (الفلاتر وأسماء الملفات القديمة محتاجاها).
   *
   * @param tx transaction المراجعين جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param language لغة ترتيب الأسماء
   * @returns الفروع
   */
  listForOptions(
    tx: Tx,
    clinicId: string,
    language: "ar" | "en",
  ): Promise<readonly PatientBranchOption[]>;
}
