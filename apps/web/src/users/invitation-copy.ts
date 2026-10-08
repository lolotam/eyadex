/** Who sent an invitation: a clinic, or the platform team (ADR-0020). */
export type InvitationArea = "clinic" | "platform";

/**
 * The text keys of the invitation page for each area. A platform-team invitee must never read that
 * they joined a clinic: the platform has no clinic, and its first sign-in asks for two-step setup.
 */
export function invitationCopy(area: InvitationArea) {
  return area === "platform"
    ? ({
        title: "inviteHttp.platformTitle",
        body: "inviteHttp.platformBody",
        acceptedTitle: "inviteHttp.platformAcceptedTitle",
        acceptedBody: "inviteHttp.platformAcceptedBody",
      } as const)
    : ({
        title: "invite.title",
        body: "inviteHttp.bodyNoRole",
        acceptedTitle: "invite.acceptedTitle",
        acceptedBody: "invite.acceptedBody",
      } as const);
}
