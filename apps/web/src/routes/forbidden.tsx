import { createFileRoute } from "@tanstack/react-router";
import { ForbiddenPage } from "@/shared/shell/forbidden-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/forbidden")({
  ...pageHead("forbidden"),
  component: ForbiddenPage,
});
