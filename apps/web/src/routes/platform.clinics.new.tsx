import { createFileRoute } from "@tanstack/react-router";
import { CreateClinicPage } from "@/platform/clinics/create-clinic-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/platform/clinics/new")({
  head: () => pageHead("New clinic", "Create a clinic together with its first admin."),
  component: CreateClinicPage,
});
