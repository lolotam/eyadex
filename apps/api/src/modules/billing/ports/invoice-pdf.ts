import type { Invoice } from "@eyadex/contracts/finance";

/** راسم الفاتورة PDF على السيرفر (spec §3.3، FIN-5)؛ نفس الراسم لصفحة الفاتورة ولرابط المراجع. */
export interface InvoicePdfRenderer {
  /**
   * بيرسم آخر نسخة من الفاتورة.
   *
   * @param clinicId العيادة (بيانات العيادة واللوجو بيتقروا جوه `withTenant` بتاعها)
   * @param invoice الفاتورة بسطورها النشطة، زي ما اتقرت دلوقتي
   * @returns ملف الـ PDF
   */
  render(clinicId: string, invoice: Invoice): Promise<Uint8Array>;
}
