/**
 * المخزن الخاص (spec §6؛ finance §3.3): مرفقات المراجعين، والـ API بيشفّرها قبل `put` وبيفكها بعد
 * `get` فالمخزن عمره ما بيشوف نص صريح، ولوجو العيادة (مش بيانات مراجع، بيتخزن زي ما هو). المفتاح
 * مافيهوش اسم ملف ولا بيانات مراجع. مفيش مسح. الربط في `medical.module.ts` و`billing.module.ts`.
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

/** رد غير متوقع من المخزن؛ التفاصيل ثابتة عشان ما تسرّبش المفتاح أو اسم الحاوية. */
export class BlobStoreAnswerError extends Error {
  constructor(
    readonly operation: "upload" | "download",
    readonly detail: string,
  ) {
    super(`Blob store ${operation}: ${detail}`);
    this.name = "BlobStoreAnswerError";
  }
}
