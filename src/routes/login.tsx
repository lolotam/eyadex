import { createFileRoute } from "@tanstack/react-router";
import { SignInPage } from "@/shared/shell/sign-in-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/login")({
  head: () => pageHead("Sign in", "Choose a demo persona to enter Eyadex."),
  component: SignInPage,
});
