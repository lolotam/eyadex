import { createFileRoute } from "@tanstack/react-router";
import { AcceptInvitationPage } from "@/users/accept-invitation-page";
import { pageHead } from "@/shared/seo/page-head";
import { arUsers } from "@/shared/i18n/ar-users";
import { enUsers } from "@/shared/i18n/en-users";

// The invitee's language is unknown on the server, so the metadata carries Arabic (default) first
// and English second, both from the dictionaries.
export const Route = createFileRoute("/invite/$token")({
  head: () =>
    pageHead(
      `${arUsers.invite.metaTitle} · ${enUsers.invite.metaTitle}`,
      `${arUsers.invite.metaDescription} ${enUsers.invite.metaDescription}`,
    ),
  component: AcceptInvitationPage,
});
