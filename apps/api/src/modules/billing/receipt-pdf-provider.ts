import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";
import { DATABASE } from "../../shared/database.provider.ts";
import type { Clock } from "../tenancy/index.ts";
import { CLOCK } from "../tenancy/index.ts";
import type { BillingPatientReader } from "./ports/billing-patients.ts";
import type { InvoicePdfAccessReader } from "./ports/invoice-pdf-access.ts";
import type { ReceiptPdfRenderer } from "./ports/receipt-pdf.ts";
import { RECEIPT_PDFS } from "./ports/tokens.ts";
import { UnavailableReceiptPdf } from "./rendering/unavailable-receipt-pdf.ts";
import { ReceiptPdfs } from "./use-cases/receipt-pdf/receipt-pdf.ts";

/** Binds the receipt seam without activating a native renderer. */
export const receiptPdfProvider = (
  patients: BillingPatientReader,
  access: InvoicePdfAccessReader,
  pdf: ReceiptPdfRenderer = new UnavailableReceiptPdf(),
) => ({
  provide: RECEIPT_PDFS,
  inject: [DATABASE, CLOCK],
  useFactory: (db: Database, clock: Clock) =>
    new ReceiptPdfs({ db, clock, ids: systemUuidV7(), patients, pdf, access }),
});
