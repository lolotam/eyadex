import { createFileRoute } from "@tanstack/react-router";
import { ClinicOverviewPage } from "@/shared/shell/clinic-overview-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/")({
  head: () => pageHead("Clinic overview", "Counts, subscription and usage for your clinic."),
  component: ClinicOverviewPage,
});
