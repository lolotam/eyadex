import type { Tx } from "@eyadex/db";
import type { InvoicePdfModel } from "../domain/invoice-pdf-model.ts";

/** بيانات العيادة والفرع المسموح طباعتها؛ التنفيذ عند مالك الجدولين. */
export interface InvoicePdfHeaderReader {
  /**
   * يقرأ رأس الطباعة داخل سياق العيادة بدون قفل يمتد إلى الرسم.
   * @param tx معاملة العيادة
   * @param clinicId العيادة
   * @param branchId فرع الفاتورة
   * @returns الرأس المسموح فقط أو null عند غياب العيادة أو الفرع
   */
  read(
    tx: Tx,
    clinicId: string,
    branchId: string,
  ): Promise<{
    clinicAr: string;
    clinicEn: string;
    timezone: string;
    address: string | null;
    phone: string | null;
  } | null>;
}

/** الرسم من نموذج مسموح؛ تحميل اللوجو يحصل بعد حجز خانة التنفيذ. */
export interface InvoicePdfModelRenderer {
  /**
   * يرسم النموذج مع اللوجو الخاص إن وجد.
   * @param model حقول الطباعة فقط
   * @param loadLogo تحميل مؤجل للوجو خارج معاملة قاعدة البيانات
   * @returns ملف PDF النهائي
   */
  render(model: InvoicePdfModel, loadLogo?: () => Promise<Buffer | null>): Promise<Uint8Array>;
}
