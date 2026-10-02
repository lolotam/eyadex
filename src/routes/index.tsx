import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "@/shared/shell/landing-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/")({
  head: () => pageHead("Sign in", "Choose a demo persona to enter Eyadex."),
  component: LandingPage,
});
