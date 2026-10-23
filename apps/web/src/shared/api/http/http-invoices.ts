import {
  invoiceDraftSchema,
  invoiceListResponseSchema,
  invoiceWriteResponseSchema,
  sendInvoiceResponseSchema,
} from "@eyadex/contracts/finance";
import type { FinanceApi } from "../finance-client";
import type { HttpContext } from "./http-context";

type InvoicePart = Pick<
  FinanceApi,
  "listInvoices" | "getInvoice" | "draft" | "issue" | "edit" | "voidInvoice" | "pdf" | "send"
>;

/** The invoice number filter is a code, not a name, so it may travel in the query. */
export function createHttpInvoices({ transport }: HttpContext): InvoicePart {
  const id = encodeURIComponent;
  return {
    listInvoices: (_persona, query) =>
      transport.send("GET", "/v1/invoices", { schema: invoiceListResponseSchema, query }),
    async getInvoice(_persona, invoiceId) {
      const answer = await transport.send("GET", `/v1/invoices/${id(invoiceId)}`, {
        schema: invoiceWriteResponseSchema,
      });
      return answer.invoice;
    },
    draft: (_persona, source, sourceId) =>
      transport.send("GET", "/v1/invoices/draft", {
        schema: invoiceDraftSchema,
        query: { source, id: sourceId },
      }),
    async issue(_persona, input, idempotencyKey) {
      const answer = await transport.send("POST", "/v1/invoices", {
        schema: invoiceWriteResponseSchema,
        body: input,
        idempotencyKey,
      });
      return answer.invoice;
    },
    async edit(_persona, invoiceId, version, input) {
      const answer = await transport.send("PATCH", `/v1/invoices/${id(invoiceId)}`, {
        schema: invoiceWriteResponseSchema,
        body: input,
        ifMatch: version,
      });
      return answer.invoice;
    },
    async voidInvoice(_persona, invoiceId, version, reason, expectedPaidMinor) {
      const answer = await transport.send("POST", `/v1/invoices/${id(invoiceId)}/void`, {
        schema: invoiceWriteResponseSchema,
        // The confirmed paid amount travels only when the screen sent one (issue #113).
        body: expectedPaidMinor === undefined ? { reason } : { reason, expectedPaidMinor },
        ifMatch: version,
      });
      return answer.invoice;
    },
    pdf: (_persona, invoiceId) => transport.download(`/v1/invoices/${id(invoiceId)}/pdf`),
    send: (_persona, invoiceId, input) =>
      transport.send("POST", `/v1/invoices/${id(invoiceId)}/send`, {
        schema: sendInvoiceResponseSchema,
        body: input,
      }),
  };
}
