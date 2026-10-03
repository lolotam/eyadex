import { createFileRoute } from "@tanstack/react-router";
import { RolesPage } from "@/roles/roles-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/roles")({
  head: () => pageHead("Roles & permissions", "Define who can do what in the clinic."),
  component: RolesPage,
});
