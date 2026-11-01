import type { Tx } from "@eyadex/db";

/** لقطة تفويض تنزيل، من الهوية دلوقتي من غير كاش أو بيانات شخصية. */
export interface ReportExportAccess {
  readonly userId: string;
  readonly membershipId: string;
  readonly active: boolean;
  readonly roleActive: boolean;
  readonly clinicStatus: string;
  readonly expiresAt: string;
  readonly financeEnabled: boolean;
  readonly permissions: readonly string[];
  readonly allBranches: boolean;
  readonly branchIds: readonly string[];
}

/** الهوية بتنفّذ القراءة؛ المالية مابتسمّيش جداول العضويات. */
export interface ReportExportAccessReader {
  /**
   * يقرأ تفويض المستخدم الحالي داخل معاملة عيادته؛ لا كاش ولا أسماء.
   *
   * @param tx معاملة العيادة
   * @param clinicId العيادة
   * @param userId مستخدم الجلسة
   * @returns اللقطة أو `null`
   */
  read(tx: Tx, clinicId: string, userId: string): Promise<ReportExportAccess | null>;
}

/** مخزن التنزيل والحذف فقط. الـ API عمره ما بيرفع ملف تصدير أو بيحط وسم عليه. */
export interface ReportExportFiles {
  /**
   * يقرأ الملف الخاص؛ أي رد غير متوقع يرفض.
   * @param key مفتاح محاولة تصدير
   * @returns البايتات المخزّنة
   */
  get(key: string): Promise<Buffer>;
  /**
   * يمسح ملف own المرفوض؛ غياب المفتاح نجاح.
   * @param key مفتاح محاولة تصدير، مفيش مفاتيح مرفقات
   * @returns بعد جواب المخزن
   */
  delete(key: string): Promise<void>;
}
