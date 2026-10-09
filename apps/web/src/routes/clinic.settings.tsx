import { createFileRoute } from "@tanstack/react-router";
import { ClinicSettingsPage } from "@/settings/clinic-settings-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/settings")({
  ...pageHead("clinicSettings"),
  component: ClinicSettingsPage,
});
