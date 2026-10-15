import { createFileRoute } from "@tanstack/react-router";
import { InvoicesPage } from "@/invoices/invoices-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/invoices/")({
  ...pageHead("clinicInvoices"),
  component: InvoicesPage,
});
