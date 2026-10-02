import { createFileRoute } from "@tanstack/react-router";
import { ForbiddenPage } from "@/shared/shell/forbidden-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/forbidden")({
  head: () => pageHead("Not allowed", "You do not have access to this page."),
  component: ForbiddenPage,
});
