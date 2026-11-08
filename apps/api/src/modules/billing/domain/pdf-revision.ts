/** هوية الرسم من مراجعات موثوقة؛ لا تقبل أي مراجعة من المتصفح. */
export interface PdfDisplayRevisions {
  readonly clinic: string;
  readonly branch: string;
  readonly patient: string;
}

/**
 * يبني هوية الرسم دون تحويل bigint إلى number.
 * @param renderer مراجعة النشر الموثوقة
 * @param revisions مراجعات العرض المقروءة من قاعدة البيانات
 * @returns هوية محدودة ومتوافقة مع سجل المهام
 */
export function pdfRevision(renderer: string, revisions: PdfDisplayRevisions): string {
  const value = `${renderer}:${revisions.clinic}:${revisions.branch}:${revisions.patient}`;
  if (!/^[A-Za-z0-9_.-]+:[1-9][0-9]*:[1-9][0-9]*:[1-9][0-9]*$/.test(value) || value.length > 256)
    throw new TypeError("invalid trusted PDF revision");
  return value;
}
