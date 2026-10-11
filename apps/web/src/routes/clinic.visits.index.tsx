import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/shared/seo/page-head";
import { VisitsPage } from "@/visits/visits-page";

export const Route = createFileRoute("/clinic/visits/")({
  ...pageHead("clinicVisits"),
  component: VisitsPage,
});
