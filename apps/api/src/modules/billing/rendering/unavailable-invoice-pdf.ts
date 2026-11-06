import { ServiceUnavailableError } from "../../../shared/errors.ts";
import type { InvoicePdfRenderer } from "../ports/invoice-pdf.ts";

/**
 * الراسم الافتراضي لحد اجتياز بوابات التنفيذ وstaging والأداء: طلب PDF بيرد 503 بدل ملف غير موثوق.
 * تنفيذ الراسم موجود، لكن ربطه للاستخدام الحقيقي يحتاج أدلة القبول المسجلة في خطة Task 8g.
 */
export class UnavailableInvoicePdf implements InvoicePdfRenderer {
  render(): Promise<Uint8Array> {
    return Promise.reject(new ServiceUnavailableError());
  }
}
