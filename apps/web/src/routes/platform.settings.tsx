import { createFileRoute } from "@tanstack/react-router";
import { PlatformSettingsPage } from "@/settings/platform-settings-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/platform/settings")({
  ...pageHead("platformSettings"),
  component: PlatformSettingsPage,
});
