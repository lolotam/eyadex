import { createFileRoute } from "@tanstack/react-router";
import { MedicinesPage } from "@/visits/medicines-page";
import { ClinicSettingsShell } from "@/settings/clinic-settings-shell";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/settings/medicines")({
  ...pageHead("clinicSettingsMedicines"),
  component: MedicinesRoute,
});

function MedicinesRoute() {
  return (
    <MedicinesPage
      frame={(content) => <ClinicSettingsShell active="medicines">{content}</ClinicSettingsShell>}
    />
  );
}
