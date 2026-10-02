import { createFileRoute } from "@tanstack/react-router";
import { ClinicSettingsPage } from "@/settings/clinic-settings-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/settings")({
  head: () => pageHead("Clinic settings", "Clinic preferences."),
  component: ClinicSettingsPage,
});
