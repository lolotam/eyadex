import { createFileRoute } from "@tanstack/react-router";
import { ReceiptsPage } from "@/payments/receipts-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/payments")({
  ...pageHead("clinicPayments"),
  component: ReceiptsPage,
});
