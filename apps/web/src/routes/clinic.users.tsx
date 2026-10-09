import { createFileRoute } from "@tanstack/react-router";
import { UsersPage } from "@/users/users-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/users")({
  ...pageHead("clinicUsers"),
  component: UsersPage,
});
