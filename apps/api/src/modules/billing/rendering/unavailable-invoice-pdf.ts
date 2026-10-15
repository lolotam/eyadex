import { ServiceUnavailableError } from "../../../shared/errors.ts";
import type { InvoicePdfRenderer } from "../ports/invoice-pdf.ts";

/**
 * الراسم لحد ما الـ PDF يتعمل (plan Task 8g، مستني تأكيد المالك على الخط): أي طلب PDF بيرد 503 بدل ما
 * يرجّع حاجة مش الفاتورة. الرابط والبحث والسجل شغالين قبله.
 */
export class UnavailableInvoicePdf implements InvoicePdfRenderer {
  render(): Promise<Uint8Array> {
    return Promise.reject(new ServiceUnavailableError());
  }
}
