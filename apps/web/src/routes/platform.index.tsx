import { createFileRoute } from "@tanstack/react-router";
import { PlatformOverviewPage } from "@/platform/platform-overview-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/platform/")({
  ...pageHead("platformOverview"),
  component: PlatformOverviewPage,
});
