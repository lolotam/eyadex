import { createFileRoute } from "@tanstack/react-router";
import { AcceptInvitationPage } from "@/users/accept-invitation-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/invite/$token")({
  head: () => pageHead("Accept invitation", "Join your clinic on Eyadex."),
  component: AcceptInvitationPage,
});
