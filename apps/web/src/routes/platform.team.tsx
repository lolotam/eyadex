import { createFileRoute } from "@tanstack/react-router";
import { PlatformTeamPage } from "@/platform/platform-team-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/platform/team")({
  ...pageHead("platformTeam"),
  component: PlatformTeamPage,
});
