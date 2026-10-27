import type { ExportCsvRow } from "../domain/export-cells.ts";
import type { ExportFence, PreparedExportJob } from "./export-store.ts";

/** صفوف ملف واحد ومجموعة المراجعين اللي اتجمّعت من نفس القراءة. */
export interface ExportBuildRows {
  readonly rows: readonly ExportCsvRow[];
  readonly patientIds: readonly string[] | null;
}

/** قراءة التقرير بعد إعادة التفويض، من غير شبكة تخزين أو كتابة فلوس. */
export interface ExportReportReader {
  /**
   * يقرأ تحت عيادة السياج وبحدود الطلب المجمّدة، ويجمع مرضى `own` من نفس الصفوف.
   *
   * @param fence هوية التأجير
   * @param job الطلب بعد إعادة التفويض
   * @param signal إيقاف المحاولة
   * @returns صفوف الكاتب ومجموعة `own` أو `null` لباقي النطاقات
   */
  read(fence: ExportFence, job: PreparedExportJob, signal: AbortSignal): Promise<ExportBuildRows>;
}

/** مخزن خاص بملفات التصدير؛ كل PUT يحمل وسم دورة الحياة. */
export interface ExportBlobStore {
  /**
   * يرفع ملفًا موسومًا `eyadex-kind=finance-export`، بمهلة لا تتجاوز خمس دقايق.
   *
   * @param key مفتاح محاولة تصدير
   * @param bytes الملف
   * @param signal إيقاف الطلب
   * @returns بعد جواب المخزن
   */
  put(key: string, bytes: Buffer, signal: AbortSignal): Promise<void>;
  /**
   * يمسح مفتاح تصدير؛ الغياب نجاح. مفيش صلاحية حذف مرفقات.
   *
   * @param key مفتاح محاولة تصدير
   * @returns بعد جواب المخزن
   */
  delete(key: string): Promise<void>;
  /**
   * يفحص مفتاحًا واحدًا من غير listing.
   *
   * @param key مفتاح محاولة تصدير
   * @returns وجود الملف؛ عطل المخزن يرمي
   */
  exists(key: string): Promise<boolean>;
}

/** عمليات دفتر الملفات اللي البناء محتاجها. مفيش شبكة جوه أي معاملة. */
export interface ExportAttemptBlobs {
  /**
   * يعيد فحص التأجير الحي وصف `allocated` بعد قفل التصدير، قبل إرسال PUT.
   *
   * @param fence سياج المحاولة
   * @returns المفتاح لو مسموح، أو `null`
   */
  uploadable(fence: ExportFence): Promise<string | null>;
  /**
   * يقرأ مفتاح المحاولة غير المنشور؛ `published` مايتحذفش حتى لو جواب النشر ضاع.
   *
   * @param fence سياج المحاولة
   * @returns المفتاح أو `null` لو مش قابل للحذف
   */
  discardable(fence: ExportFence): Promise<string | null>;
  /**
   * يسجّل أول حذف بعد حذف البايتات، من `allocated` أو `uploaded` فقط.
   *
   * @param fence سياج المحاولة
   * @returns بعد تسجيل الحالة؛ `deleted` و`gone` يفضلوا زي ما هم
   */
  markDeleted(fence: ExportFence): Promise<void>;
}
