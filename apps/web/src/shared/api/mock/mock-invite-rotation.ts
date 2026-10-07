import { computeInvitationStatus, INVITATION_TTL_DAYS } from "@eyadex/contracts/invitations";
import { ApiError } from "../api-error";
import type { Actor } from "./mock-actor";
import { invitationAuditSnapshot, issueInviteToken } from "./mock-invite-tokens";
import type { MockState } from "./mock-store";
import {
  enforceAssignableBranches,
  enforceAssignableRole,
  enforceEmailFree,
  enforceMayTouchAdmin,
  enforceUserLimit,
} from "./mock-user-rules";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Resend and copy-link share this rotation, in the API's order (ADR-0012 §6): pending only, active
 * role and branches, the admin-role guard, a seat when expired, then a new token and expiry — so
 * every older link, including an emailed one, stops working.
 */
export function rotateInvitationLink(db: MockState, actor: Actor, invitationId: string) {
  const inv = db.invitations.find((i) => i.clinicId === actor.clinic.id && i.id === invitationId);
  if (!inv) throw new ApiError("not_found");
  const status = computeInvitationStatus(inv);
  if (status === "accepted") throw new ApiError("invitation_used");
  if (status === "cancelled") throw new ApiError("invitation_cancelled");
  enforceAssignableRole(db, actor.clinic.id, inv.roleId);
  enforceAssignableBranches(db, actor.clinic.id, inv);
  enforceMayTouchAdmin(db, actor.role, inv.roleId);
  if (status === "expired") {
    // An expired invitation stops counting; renewing it must fit the limit and the email rule again.
    enforceUserLimit(db, actor.clinic.id);
    enforceEmailFree(db, inv.email, inv.id);
  }
  const before = invitationAuditSnapshot(inv);
  inv.expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * DAY).toISOString();
  const token = issueInviteToken(db, inv);
  return { inv, before, token };
}
