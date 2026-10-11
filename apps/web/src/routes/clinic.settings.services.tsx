import { createFileRoute } from "@tanstack/react-router";
import { ServicesPage } from "@/services/services-page";
import { ClinicSettingsShell } from "@/settings/clinic-settings-shell";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/settings/services")({
  ...pageHead("clinicSettingsServices"),
  component: ServicesRoute,
});

function ServicesRoute() {
  return (
    <ServicesPage
      frame={(content) => <ClinicSettingsShell active="services">{content}</ClinicSettingsShell>}
    />
  );
}
