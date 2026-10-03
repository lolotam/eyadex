import { createFileRoute } from "@tanstack/react-router";
import { ClinicLayout } from "@/shared/shell/clinic-layout";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic")({
  head: () => pageHead("Clinic", "Clinic workspace."),
  component: ClinicLayout,
});
