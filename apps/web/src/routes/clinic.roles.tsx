import { createFileRoute } from "@tanstack/react-router";
import { RolesPage } from "@/roles/roles-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/roles")({
  ...pageHead("clinicRoles"),
  component: RolesPage,
});
