import type { Invoice } from "@eyadex/contracts/finance";
import type { Database } from "@eyadex/db";
import type { BlobStore } from "../../../shared/blob/blob-store.ts";
import { ApiError } from "../../../shared/errors.ts";
import { invoicePdfModel } from "../domain/invoice-pdf-model.ts";
import { LOGO_MAX_BYTES, logoType } from "../domain/logo.ts";
import { readPdfBranding } from "../persistence/pg-pdf-branding.ts";
import type { BillingPatientReader } from "../ports/billing-patients.ts";
import type { InvoicePdfRenderer } from "../ports/invoice-pdf.ts";
import type {
  InvoicePdfHeaderReader,
  InvoicePdfModelRenderer,
} from "../ports/invoice-pdf-model.ts";
import { PdfProcessError } from "./pdf-process.ts";

/** يربط لقطة الفاتورة برأسها واسم العرض؛ لا يحمل معاملة مفتوحة أثناء الرسم. */
export class InvoicePdfDocument implements InvoicePdfRenderer {
  constructor(
    private readonly deps: {
      db: Database;
      header: InvoicePdfHeaderReader;
      patients: Pick<BillingPatientReader, "displayName">;
      blobs: BlobStore;
      renderer: InvoicePdfModelRenderer;
    },
  ) {}

  async render(clinicId: string, invoice: Invoice): Promise<Uint8Array> {
    const context = await this.deps.db.withTenant(clinicId, async (tx) => {
      const header = await this.deps.header.read(tx, clinicId, invoice.branchId);
      const branding = await readPdfBranding(tx, clinicId);
      const patientName = await this.deps.patients.displayName(tx, clinicId, invoice.patientId);
      if (!header || !branding || !patientName) throw new ApiError("not_found");
      return {
        header: { ...header, commercialRegNo: branding.commercialRegNo },
        logoKey: branding.logoKey,
        patientName,
      };
    });
    try {
      const model = invoicePdfModel(invoice, context.header, context.patientName);
      return await this.deps.renderer.render(model, async () => {
        if (context.logoKey === null) return null;
        const bytes = await this.deps.blobs.get(context.logoKey);
        if (bytes.length > LOGO_MAX_BYTES || logoType(bytes) === null)
          throw new ApiError("pdf_render_failed");
        return bytes;
      });
    } catch (error) {
      // Neither parser failures nor blob errors may leak document text or private keys.
      throw new ApiError(
        error instanceof PdfProcessError && error.code === "pdf_busy"
          ? "pdf_busy"
          : "pdf_render_failed",
      );
    }
  }
}
