import { createFileRoute } from "@tanstack/react-router";
import { ServicesPage } from "@/services/services-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/settings/services")({
  ...pageHead("clinicSettingsServices"),
  component: ServicesPage,
});
