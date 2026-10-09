import { createFileRoute } from "@tanstack/react-router";
import { AccountPage } from "@/settings/account-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/account")({
  ...pageHead("clinicAccount"),
  component: AccountPage,
});
