import { createFileRoute } from "@tanstack/react-router";
import { PatientDetailPage } from "@/patients/patient-detail-page";
import { pageHead } from "@/shared/seo/page-head";
import { PATIENT_MEDICAL_TABS } from "@/visits/patient-medical-tabs";

export const Route = createFileRoute("/clinic/patients/$patientId")({
  ...pageHead("clinicPatientFile"),
  component: PatientFileRoute,
});

function PatientFileRoute() {
  const { patientId } = Route.useParams();
  // The medical tabs belong to the visits area: the route composes them (§1.1).
  return <PatientDetailPage patientId={patientId} extraTabs={PATIENT_MEDICAL_TABS} />;
}
