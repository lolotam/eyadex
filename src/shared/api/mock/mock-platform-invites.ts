import { computeInvitationStatus, INVITATION_TTL_DAYS } from "@contracts/invitations";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { issueInviteToken } from "./mock-invite-tokens";
import { delay, getState, newId, persist, type MockState } from "./mock-store";
import { enforceEmailFree, enforceUserLimit, isAdminRole } from "./mock-user-rules";

const DAY = 24 * 60 * 60 * 1000;
const ACTOR = "Waleed Mohamed";

/** The latest clinic-admin invitation, while no clinic admin is active yet (story 19). */
function openFirstAdminInvitation(db: MockState, clinicId: string) {
  if (!db.clinics.some((c) => c.id === clinicId)) throw new ApiError("not_found");
  const hasAdmin = db.members.some(
    (m) => m.clinicId === clinicId && m.status === "active" && isAdminRole(db, m.roleId),
  );
  if (hasAdmin) return null;
  return (
    db.invitations
      .filter((i) => i.clinicId === clinicId && isAdminRole(db, i.roleId))
      .filter((i) => computeInvitationStatus(i) !== "accepted")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

export function createMockPlatformInvites(): Pick<
  ApiClient["platform"],
  "getFirstAdminInvitation" | "resendFirstAdminInvitation"
> {
  return {
    async getFirstAdminInvitation(clinicId) {
      await delay(80);
      const inv = openFirstAdminInvitation(getState(), clinicId);
      if (!inv) return null;
      const status = computeInvitationStatus(inv);
      if (status === "accepted") return null;
      return { email: inv.email, fullName: inv.fullName, status, expiresAt: inv.expiresAt };
    },

    async resendFirstAdminInvitation(clinicId) {
      await delay();
      const db = getState();
      const inv = openFirstAdminInvitation(db, clinicId);
      if (!inv) throw new ApiError("invitation_used");
      const status = computeInvitationStatus(inv);
      if (status === "cancelled") throw new ApiError("invitation_cancelled");
      if (status === "expired") {
        enforceEmailFree(db, inv.email, inv.id);
        enforceUserLimit(db, clinicId);
      }
      inv.expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * DAY).toISOString();
      const token = issueInviteToken(db, inv);
      // The summary names the email only; the link token never reaches the audit log.
      db.platformAudit.unshift({
        id: newId(),
        actorName: ACTOR,
        action: "invitation.resent",
        clinicId,
        summary: `Resent the first admin invitation to ${inv.email}`,
        createdAt: new Date().toISOString(),
      });
      persist();
      return { email: inv.email, token, expiresAt: inv.expiresAt };
    },
  };
}
