import { createFileRoute } from "@tanstack/react-router";
import { INVOICE_ENCOUNTER_SLOTS } from "@/invoices/invoice-encounter-slots";
import { EncounterSlotsProvider } from "@/shared/shell/encounter-slots";
import { pageHead } from "@/shared/seo/page-head";
import { VisitPage } from "@/visits/visit-page";

export const Route = createFileRoute("/clinic/visits/$visitId")({
  ...pageHead("clinicVisit"),
  component: VisitRoute,
});

function VisitRoute() {
  const { visitId } = Route.useParams();
  return (
    <EncounterSlotsProvider slots={INVOICE_ENCOUNTER_SLOTS}>
      <VisitPage visitId={visitId} />
    </EncounterSlotsProvider>
  );
}
