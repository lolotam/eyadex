import { createFileRoute } from "@tanstack/react-router";
import { WhatsappSettingsPage } from "@/settings/whatsapp-settings-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/settings/whatsapp")({
  ...pageHead("clinicSettingsWhatsapp"),
  component: WhatsappSettingsPage,
});
