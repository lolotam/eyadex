import type { Payment } from "@eyadex/contracts/finance";

/** راسم إيصال تاريخي؛ لا يحسب صافي الدفع بعد الاسترداد. */
export interface ReceiptPdfRenderer {
  /**
   * يرسم الدفعة الأصلية باسم المراجع الحالي، داخل حدود عيادتها.
   * @param clinicId العيادة المالكة للإيصال
   * @param payment الدفعة الأصلية المقروءة بعد فحص نطاق العرض
   * @returns ملف PDF، أو رفض الرسم من غير ملف جزئي
   */
  render(clinicId: string, payment: Payment): Promise<Uint8Array>;
}
