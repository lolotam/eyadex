import { createFileRoute } from "@tanstack/react-router";
import { ClinicsListPage } from "@/platform/clinics/clinics-list-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/platform/clinics/")({
  head: () => pageHead("Clinics", "Search and manage every clinic on the platform."),
  component: ClinicsListPage,
});
