import { ServiceUnavailableError } from "../../../shared/errors.ts";
import type { ReceiptPdfRenderer } from "../ports/receipt-pdf.ts";
import { PDF_UNAVAILABLE } from "./pdf-unavailable.ts";

/** يظل الإيصال غير مفعّل حتى اجتياز بوابات الراسم والتسليم. */
export class UnavailableReceiptPdf implements ReceiptPdfRenderer {
  render(): Promise<Uint8Array> {
    return Promise.reject(new ServiceUnavailableError({ code: PDF_UNAVAILABLE }));
  }
}
