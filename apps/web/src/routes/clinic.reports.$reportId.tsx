import { createFileRoute } from "@tanstack/react-router";
import { ReportScreenPage } from "@/report-exports/screens/report-screen-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/reports/$reportId")({
  ...pageHead("clinicReport"),
  component: ReportScreenPage,
});
