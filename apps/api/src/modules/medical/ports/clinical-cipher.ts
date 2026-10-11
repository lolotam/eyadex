/** مكان القيمة المشفّرة: الجدول والعمود وصف القيمة نفسها (الـ additional data، ADR-0028). */
export interface FieldRef {
  readonly table: string;
  readonly column: string;
  readonly rowId: string;
}

/**
 * التشفير اللي موديول الطب محتاجه لكل عمود `*_enc` (ADR-0028). `FieldCipher` من `@eyadex/secrets`
 * بينفّذه زي ما هو، والربط في `medical.module.ts` بس، فالكود الطبي عمره ما بيلمس مفتاح.
 */
export interface ClinicalCipher {
  /**
   * يشفّر نص مربوط بالعيادة والجدول والعمود والصف: نسخه لمكان تاني عمرها ما تتفتح.
   *
   * @param clinicId العيادة (مفتاحها مشتق منها)
   * @param ref مكان القيمة
   * @param plain النص
   * @returns الظرف `f1.<version>.…`
   */
  seal(clinicId: string, ref: FieldRef, plain: string): string;

  /**
   * يفك ظرف اتشفّر لنفس المكان بالظبط؛ أي اختلاف أو تلاعب بيرمي.
   *
   * @param clinicId العيادة
   * @param ref مكان القيمة
   * @param envelope الظرف
   * @returns النص
   */
  open(clinicId: string, ref: FieldRef, envelope: string): string;
}
