import { createFileRoute } from "@tanstack/react-router";
import { NewInvoicePage } from "@/invoices/new-invoice-page";
import { pageHead } from "@/shared/seo/page-head";

type Search = { source?: "appointment" | "visit"; id?: string };

export const Route = createFileRoute("/clinic/invoices/new")({
  ...pageHead("clinicInvoiceNew"),
  validateSearch: (search: Record<string, unknown>): Search => {
    const source =
      search["source"] === "appointment" || search["source"] === "visit"
        ? search["source"]
        : undefined;
    const id =
      typeof search["id"] === "string" && /^[0-9a-f-]{36}$/i.test(search["id"])
        ? search["id"]
        : undefined;
    return source && id ? { source, id } : {};
  },
  component: NewInvoiceRoute,
});

function NewInvoiceRoute() {
  const { source, id } = Route.useSearch();
  return <NewInvoicePage source={source && id ? { source, sourceId: id } : null} />;
}
