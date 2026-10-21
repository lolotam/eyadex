import { createFileRoute } from "@tanstack/react-router";
import { InvoicePage } from "@/invoices/invoice-page";
import { InvoicePaymentPanel } from "@/payments/invoice-payment-panel";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/invoices/$invoiceId")({
  ...pageHead("clinicInvoice"),
  component: InvoiceRoute,
});

// ADR-0030: the route composes the two areas; invoices/ and payments/ never import each other.
function InvoiceRoute() {
  const { invoiceId } = Route.useParams();
  return (
    <InvoicePage
      invoiceId={invoiceId}
      paymentPanel={(invoice, refresh) => (
        <InvoicePaymentPanel invoice={invoice} onChanged={refresh} />
      )}
    />
  );
}
