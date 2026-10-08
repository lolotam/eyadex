import {
  acceptInvitationResponseSchema,
  inspectInvitationResponseSchema,
  type AcceptInvitationResponse,
  type InspectInvitationResponse,
} from "@eyadex/contracts/invitation-acceptance";
import {
  invitationLinkSchema,
  invitationSchema,
  type AcceptedInvitation,
  type Invitation,
  type InvitationLink,
  type InvitationPreview,
} from "@eyadex/contracts/invitations";
import { invitationListResponseSchema } from "@eyadex/contracts/user-admin";
import {
  acceptPlatformInvitationResponseSchema,
  inspectPlatformInvitationResponseSchema,
  type InspectPlatformInvitationResponse,
} from "@eyadex/contracts/platform-console";
import { areaOfHost } from "../area-host";
import type { ApiClient } from "../api-client";
import type { HttpContext } from "./http-context";

export function toInvitation(invitation: Invitation): Invitation {
  return { ...invitation, branchIds: [...invitation.branchIds] };
}

export function toInvitationLink(link: InvitationLink): InvitationLink {
  return { token: link.token, expiresAt: link.expiresAt };
}

/** The API answers inspect only for a usable link, so the status is pending; it names no role. */
export function toPreview(answer: InspectInvitationResponse): InvitationPreview {
  return {
    clinicNameAr: answer.clinicNameAr,
    clinicNameEn: answer.clinicNameEn,
    roleNameAr: null,
    roleNameEn: null,
    fullName: answer.fullName,
    email: answer.email,
    status: "pending",
  };
}

/** A platform-team link (ADR-0020): the team is named by the brand, written in Latin in both languages. */
export function toPlatformPreview(answer: InspectPlatformInvitationResponse): InvitationPreview {
  return {
    clinicNameAr: "Eyadex",
    clinicNameEn: "Eyadex",
    roleNameAr: null,
    roleNameEn: null,
    fullName: answer.fullName,
    email: answer.email,
    status: "pending",
    area: "platform",
  };
}

const onPlatformHost = () =>
  typeof window !== "undefined" && areaOfHost(window.location.hostname) === "platform";

/** No session is opened (ADR-0008): no member id, the person signs in afterwards. */
export function toAccepted(answer: AcceptInvitationResponse): AcceptedInvitation {
  return { clinicId: answer.clinicId, memberId: null, roleKey: null };
}

const path = (id: string) => `/v1/invitations/${encodeURIComponent(id)}`;

export function createHttpInvitations(ctx: HttpContext): ApiClient["invitations"] {
  const { transport } = ctx;
  const post = (id: string, action: "resend" | "cancel") =>
    transport.send("POST", `${path(id)}/${action}`, { schema: invitationSchema });
  return {
    async list(_persona, query) {
      const page = await transport.send("GET", "/v1/invitations", {
        schema: invitationListResponseSchema,
        query: {
          cursor: query.cursor,
          limit: query.limit,
          search: query.search.trim(),
          status: query.status,
        },
      });
      return {
        items: page.items.map(toInvitation),
        nextCursor: page.nextCursor,
        total: page.total,
      };
    },
    async invite(_persona, input, idempotencyKey) {
      const invitation = await transport.send("POST", "/v1/invitations", {
        schema: invitationSchema,
        body: {
          fullName: input.fullName,
          email: input.email,
          roleId: input.roleId,
          allBranches: input.allBranches,
          branchIds: input.branchIds,
        },
        idempotencyKey,
      });
      return toInvitation(invitation);
    },
    resend: async (_persona, id) => toInvitation(await post(id, "resend")),
    cancel: async (_persona, id) => toInvitation(await post(id, "cancel")),
    copyLink: async (_persona, id) =>
      toInvitationLink(
        await transport.send("POST", `${path(id)}/link`, { schema: invitationLinkSchema }),
      ),
    // The token travels in the body only, never in a URL (ADR-0008). On the platform host the link
    // is a platform-team invitation (ADR-0020).
    preview: async (token) =>
      onPlatformHost()
        ? toPlatformPreview(
            await transport.send("POST", "/v1/platform/invitations/inspect", {
              schema: inspectPlatformInvitationResponseSchema,
              body: { token },
            }),
          )
        : toPreview(
            await transport.send("POST", "/v1/invitations/inspect", {
              schema: inspectInvitationResponseSchema,
              body: { token },
            }),
          ),
    accept: async (token, input) => {
      if (onPlatformHost()) {
        await transport.send("POST", "/v1/platform/invitations/accept", {
          schema: acceptPlatformInvitationResponseSchema,
          body: { token, password: input.password },
        });
        return { clinicId: null, memberId: null, roleKey: null };
      }
      return toAccepted(
        await transport.send("POST", "/v1/invitations/accept", {
          schema: acceptInvitationResponseSchema,
          body: { token, password: input.password },
        }),
      );
    },
  };
}
