import { createFileRoute } from "@tanstack/react-router";
import { PlatformLayout } from "@/shared/shell/platform-layout";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/platform")({
  head: () => pageHead("Platform", "Platform administration for Clinic App."),
  component: PlatformLayout,
});
