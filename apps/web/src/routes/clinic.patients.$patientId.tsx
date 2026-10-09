import { createFileRoute } from "@tanstack/react-router";
import { PatientDetailPage } from "@/patients/patient-detail-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/patients/$patientId")({
  ...pageHead("clinicPatientFile"),
  component: PatientFileRoute,
});

function PatientFileRoute() {
  const { patientId } = Route.useParams();
  return <PatientDetailPage patientId={patientId} />;
}
