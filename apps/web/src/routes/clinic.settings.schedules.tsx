import { createFileRoute } from "@tanstack/react-router";
import { SchedulesPage } from "@/schedules/schedules-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/settings/schedules")({
  ...pageHead("clinicSettingsSchedules"),
  component: SchedulesPage,
});
