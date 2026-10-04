import type { BranchReader, BranchRecord, NameLanguage } from "../ports/branch-reader.ts";

/**
 * فروع العيادة للعرض: النشطة الأول ثم بالاسم في لغة المستخدم.
 *
 * @param reader قارئ الفروع
 * @param clinicId uuid العيادة
 * @param language لغة الترتيب
 * @returns الفروع مرتبة
 */
export function listClinicBranches(
  reader: BranchReader,
  clinicId: string,
  language: NameLanguage,
): Promise<readonly BranchRecord[]> {
  return reader.listBranches(clinicId, language);
}
