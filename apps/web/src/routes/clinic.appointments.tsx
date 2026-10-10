import { createFileRoute } from "@tanstack/react-router";
import { AppointmentsPage } from "@/appointments/appointments-page";
import { parseAppointmentView, type AppointmentView } from "@/appointments/appointment-view";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/appointments")({
  ...pageHead("clinicAppointments"),
  validateSearch: (search: Record<string, unknown>): { view?: AppointmentView } =>
    search["view"] === undefined ? {} : { view: parseAppointmentView(search["view"]) },
  component: AppointmentsPage,
});
