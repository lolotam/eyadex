import { createFileRoute } from "@tanstack/react-router";
import { PatientsPage } from "@/patients/patients-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/patients")({
  head: () => pageHead("Patients", "Patient files and registration."),
  component: PatientsPage,
});
