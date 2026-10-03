import { createFileRoute } from "@tanstack/react-router";
import { PatientDetailPage } from "@/patients/patient-detail-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/patients/$patientId")({
  head: () =>
    pageHead("Patient file", "A patient file; every opening is recorded in the audit log."),
  component: PatientFileRoute,
});

function PatientFileRoute() {
  const { patientId } = Route.useParams();
  return <PatientDetailPage patientId={patientId} />;
}
