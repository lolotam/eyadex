import { createFileRoute } from "@tanstack/react-router";
import { NotificationSettingsPage } from "@/settings/notification-settings-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/clinic/settings/notifications")({
  ...pageHead("clinicSettingsNotifications"),
  component: NotificationSettingsPage,
});
