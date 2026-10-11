/**
 * مخزن محتوى المرفقات (spec §6). الـ API بيشفّر قبل `put` وبيفك بعد `get`، فالمخزن عمره ما بيشوف نص
 * صريح، والمفتاح مافيهوش اسم ملف ولا بيانات مراجع. مفيش مسح: الأرشفة حالة في الجدول. الربط في
 * `medical.module.ts` بس.
 */
export interface BlobStore {
  /**
   * يخزّن البايتات تحت المفتاح؛ أي رد مش متوقع من المخزن بيرمي، عمره ما بيعدّي بصمت.
   *
   * @param key `clinic/<clinicId>/<attachmentId>`
   * @param bytes الظرف المشفّر
   * @returns بيخلص لما المخزن يأكد
   */
  put(key: string, bytes: Buffer): Promise<void>;

  /**
   * يرجّع البايتات اللي اتخزنت تحت المفتاح بالظبط؛ مش موجودة أو رد غلط = خطأ.
   *
   * @param key `clinic/<clinicId>/<attachmentId>`
   * @returns الظرف المشفّر
   */
  get(key: string): Promise<Buffer>;
}
