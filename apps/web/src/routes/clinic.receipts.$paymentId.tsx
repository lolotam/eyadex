import { createFileRoute } from "@tanstack/react-router";
import { ReceiptPage } from "@/payments/receipt-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/receipts/$paymentId")({
  ...pageHead("clinicReceipt"),
  component: ReceiptRoute,
});

function ReceiptRoute() {
  const { paymentId } = Route.useParams();
  return <ReceiptPage paymentId={paymentId} />;
}
