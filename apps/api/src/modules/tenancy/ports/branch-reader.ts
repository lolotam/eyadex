/** لغة الترتيب بالاسم. */
export type NameLanguage = "ar" | "en";

/** فرع كما يقراه الـ tenancy. */
export interface BranchRecord {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** قراية فروع عيادة واحدة جوه سياقها (`withTenant`). */
export interface BranchReader {
  /**
   * فروع العيادة: النشطة الأول، وبعدين بالاسم في اللغة المطلوبة، وبعدين بالـ id للثبات.
   *
   * @param clinicId uuid العيادة
   * @param language لغة الاسم اللي بيترتب بيه
   * @returns الفروع مرتبة؛ قايمة فاضية لو العيادة مش ظاهرة
   */
  listBranches(clinicId: string, language: NameLanguage): Promise<readonly BranchRecord[]>;
}

/** Token الـ DI للـ BranchReader. */
export const BRANCH_READER = Symbol("tenancy.BranchReader");
