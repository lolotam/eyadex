import { createFileRoute } from "@tanstack/react-router";
import { CashClosingsPage } from "@/cash-closings/cash-closings-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/cash-closings/")({
  ...pageHead("clinicCashClosings"),
  component: CashClosingsPage,
});
