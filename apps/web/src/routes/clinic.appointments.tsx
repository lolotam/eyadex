import { createFileRoute } from "@tanstack/react-router";
import { AppointmentsPage } from "@/appointments/appointments-page";
import { parseAppointmentView, type AppointmentView } from "@/appointments/appointment-view";
import { INVOICE_ENCOUNTER_SLOTS } from "@/invoices/invoice-encounter-slots";
import { EncounterSlotsProvider } from "@/shared/shell/encounter-slots";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/appointments")({
  ...pageHead("clinicAppointments"),
  validateSearch: (search: Record<string, unknown>): { view?: AppointmentView } =>
    search["view"] === undefined ? {} : { view: parseAppointmentView(search["view"]) },
  component: AppointmentsRoute,
});

function AppointmentsRoute() {
  return (
    <EncounterSlotsProvider slots={INVOICE_ENCOUNTER_SLOTS}>
      <AppointmentsPage />
    </EncounterSlotsProvider>
  );
}
