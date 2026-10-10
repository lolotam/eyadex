import { createFileRoute } from "@tanstack/react-router";
import { AppointmentsPage } from "@/appointments/appointments-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/appointments")({
  ...pageHead("clinicAppointments"),
  component: AppointmentsPage,
});
