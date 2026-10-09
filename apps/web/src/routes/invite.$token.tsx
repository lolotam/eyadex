import { createFileRoute } from "@tanstack/react-router";
import { AcceptInvitationPage } from "@/users/accept-invitation-page";
import { pageHead } from "@/shared/seo/page-head";

export const Route = createFileRoute("/invite/$token")({
  ...pageHead("invite"),
  component: AcceptInvitationPage,
});
