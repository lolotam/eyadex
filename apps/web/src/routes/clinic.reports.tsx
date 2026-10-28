import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage } from "@/report-exports/reports-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/reports")({
  ...pageHead("clinicReports"),
  component: ReportsPage,
});
