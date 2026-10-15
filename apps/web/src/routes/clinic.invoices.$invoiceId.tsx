import { createFileRoute } from "@tanstack/react-router";
import { InvoicePage } from "@/invoices/invoice-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/invoices/$invoiceId")({
  ...pageHead("clinicInvoice"),
  component: InvoiceRoute,
});

function InvoiceRoute() {
  const { invoiceId } = Route.useParams();
  return <InvoicePage invoiceId={invoiceId} />;
}
