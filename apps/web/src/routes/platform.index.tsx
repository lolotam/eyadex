import { createFileRoute } from "@tanstack/react-router";
import { PlatformOverviewPage } from "@/platform/platform-overview-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/platform/")({
  head: () => pageHead("Platform overview", "Clinics by status and upcoming expiries."),
  component: PlatformOverviewPage,
});
