import { createFileRoute } from "@tanstack/react-router";
import { ClinicPage } from "@/platform/clinics/clinic-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/platform/clinics/$clinicId")({
  head: () => pageHead("Clinic", "Clinic details, subscription, modules, users and branches."),
  component: ClinicRoutePage,
});

function ClinicRoutePage() {
  const { clinicId } = Route.useParams();
  return <ClinicPage clinicId={clinicId} />;
}
