import { createFileRoute } from "@tanstack/react-router";
import { MailProvidersPage } from "@/settings/mail-providers-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/settings/email")({
  ...pageHead("clinicSettingsEmail"),
  component: MailProvidersPage,
});
