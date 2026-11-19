import { describe, expect, it } from "vitest";
import { ServiceUnavailableError } from "../../../shared/errors.ts";
import { PDF_UNAVAILABLE } from "../rendering/pdf-unavailable.ts";
import { UnavailableInvoicePdf } from "../rendering/unavailable-invoice-pdf.ts";
import { UnavailableReceiptPdf } from "../rendering/unavailable-receipt-pdf.ts";

// Both default renderers refuse with the same 503 and a marker the web can read, never a file.
describe.each([
  ["invoice", () => new UnavailableInvoicePdf().render()],
  ["receipt", () => new UnavailableReceiptPdf().render()],
])("the default %s PDF renderer", (_name, render) => {
  it("refuses with a 503 that says the PDF is unavailable", async () => {
    const error = await render().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    const refusal = error as ServiceUnavailableError;
    expect(refusal.status).toBe(503);
    expect(refusal.code).toBe("unknown");
    expect(refusal.details).toEqual({ code: PDF_UNAVAILABLE });
  });
});
