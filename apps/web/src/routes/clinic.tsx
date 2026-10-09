import { createFileRoute } from "@tanstack/react-router";
import { ClinicLayout } from "@/shared/shell/clinic-layout";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic")({
  ...pageHead("clinic"),
  component: ClinicLayout,
});
