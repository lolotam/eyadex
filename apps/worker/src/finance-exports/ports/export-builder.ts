import type { Readable } from "node:stream";
import type { ExportCsvRow } from "../domain/export-cells.ts";
import type { ExportFence, PreparedExportJob } from "./export-store.ts";

/** الكاتب بيتحدد من الطلب المعاد تفويضه داخل القراءة، وبيستقبل صفًا واحدًا في كل نداء. */
export interface ExportBuildSink {
  /**
   * يجهز الكاتب من الطلب الحالي المعاد تفويضه، مش من لقطة تمهيدية.
   * @param job الطلب المجمّد الحالي
   * @returns بعد تجهيز الملف المؤقت المشفّر
   */
  start(job: PreparedExportJob): Promise<void>;
  /**
   * يكتب صفًا مع backpressure.
   * @param row صف مطبّع واحد
   * @returns بعد قبول الصف
   */
  write(row: ExportCsvRow): Promise<void>;
  /**
   * ينهي الكاتب قبل تسجيل اكتمال مجموعة own.
   * @returns بعد اكتمال الملف المحلي المشفّر، من غير رفع
   */
  finish(): Promise<void>;
}

/** قراءة صفحات تحت RLS من لقطة مالية واحدة، مع إعادة التفويض لكل صفحة. */
export interface ExportReportReader {
  /**
   * يقرأ التقرير تدريجيًا؛ مجموعة own تفضل في سجل SQL مربوط بنفس المحاولة.
   *
   * @param fence هوية التأجير
   * @param job لقطة تمهيدية فقط؛ القارئ يشتق الطلب ويعيد التفويض من السياج داخل معاملة القراءة
   * @param signal إيقاف المحاولة
   * @param sink الكاتب المحلي المشفّر
   * @returns نمط مجموعة own؛ مفيش صفوف أو مصفوفة مراجعين في الذاكرة
   */
  read(
    fence: ExportFence,
    job: PreparedExportJob,
    signal: AbortSignal,
    sink: ExportBuildSink,
  ): Promise<{ patientSet: "ledger" | null }>;
}

/** مخزن خاص بملفات التصدير؛ كل PUT يحمل وسم دورة الحياة. */
export interface ExportBlobStore {
  /**
   * يرفع ملفًا موسومًا `eyadex-kind=finance-export`، بمهلة لا تتجاوز خمس دقايق.
   *
   * @param key مفتاح محاولة تصدير
   * @param file الملف المشفّر بطول معلوم
   * @param signal إيقاف الطلب
   * @returns بعد جواب المخزن
   */
  put(
    key: string,
    file: { readonly storedLength: number; ciphertext(): Readable },
    signal: AbortSignal,
  ): Promise<void>;
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
