import { createFileRoute } from "@tanstack/react-router";
import { SchedulesPage } from "@/schedules/schedules-page";
import { ClinicSettingsShell } from "@/settings/clinic-settings-shell";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/settings/schedules")({
  ...pageHead("clinicSettingsSchedules"),
  component: SchedulesRoute,
});

function SchedulesRoute() {
  return (
    <SchedulesPage
      frame={(content) => <ClinicSettingsShell active="schedules">{content}</ClinicSettingsShell>}
    />
  );
}
