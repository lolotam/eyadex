import { createFileRoute } from "@tanstack/react-router";
import { CashClosingPage } from "@/cash-closings/cash-closing-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/cash-closings/$closingId")({
  ...pageHead("clinicCashClosing"),
  component: ClosingRoute,
});

function ClosingRoute() {
  const { closingId } = Route.useParams();
  return <CashClosingPage closingId={closingId} />;
}
