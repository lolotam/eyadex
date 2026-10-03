import {
  acceptInvitationInputSchema,
  computeInvitationStatus,
  INVITATION_TTL_DAYS,
  invitationListQuerySchema,
  type InvitationRecord,
} from "@eyadex/contracts/invitations";
import { inviteUserInputSchema, type MembershipUser } from "@eyadex/contracts/users";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { authorize, clinicBlockReason, effectivePermissions } from "./mock-actor";
import { writeClinicAudit } from "./mock-audit";
import {
  findInvitationByToken,
  invitationAuditSnapshot,
  issueInviteToken,
} from "./mock-invite-tokens";
import { delay, getState, newId, persist, type MockState } from "./mock-store";
import {
  enforceAssignableBranches,
  enforceAssignableRole,
  enforceEmailFree,
  enforceUserLimit,
  paginate,
  toInvitationView,
} from "./mock-user-rules";

const DAY = 24 * 60 * 60 * 1000;

function findInvitation(db: MockState, clinicId: string, id: string): InvitationRecord {
  const inv = db.invitations.find((i) => i.clinicId === clinicId && i.id === id);
  if (!inv) throw new ApiError("not_found");
  return inv;
}

/** INV-01: only a pending, unexpired invitation can be used. */
function usableInvitation(db: MockState, token: string): InvitationRecord {
  const inv = findInvitationByToken(db, token);
  if (!inv) throw new ApiError("not_found");
  const status = computeInvitationStatus(inv);
  if (status === "expired") throw new ApiError("invitation_expired");
  if (status === "cancelled") throw new ApiError("invitation_cancelled");
  if (status === "accepted") throw new ApiError("invitation_used");
  return inv;
}

export function createMockInvitations(): ApiClient["invitations"] {
  return {
    async list(persona, rawQuery) {
      await delay();
      const parsed = invitationListQuerySchema.safeParse(rawQuery);
      if (!parsed.success) throw new ApiError("validation");
      const query = parsed.data;
      const db = getState();
      const actor = authorize(db, persona, "view", "users");
      const { clinic } = actor;
      const mayCreate = effectivePermissions(db, actor).includes("create:users:clinic");
      const term = query.search.toLocaleLowerCase();
      const rows = db.invitations
        .filter((i) => i.clinicId === clinic.id)
        .map((i) => toInvitationView(db, i, mayCreate))
        .filter((i) => !query.status || i.status === query.status)
        .filter(
          (i) =>
            !term ||
            i.fullName.toLocaleLowerCase().includes(term) ||
            i.email.toLocaleLowerCase().includes(term),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return paginate(rows, query.cursor, query.limit);
    },

    async invite(persona, rawInput, idempotencyKey) {
      await delay();
      const parsed = inviteUserInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new ApiError("validation");
      const input = parsed.data;
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "create", "users");
      const replayKey = `${clinic.id}:${idempotencyKey}`;
      // The same key must carry the same request; a changed recipient or assignment is a conflict,
      // never a silent success for the old invitation.
      const fingerprint = JSON.stringify({
        email: input.email.trim().toLowerCase(),
        fullName: input.fullName,
        roleId: input.roleId,
        allBranches: input.allBranches,
        branchIds: [...input.branchIds].sort(),
      });
      const previous = db.idempotentInvites?.[replayKey];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ApiError("idempotency_conflict");
        const replayed = db.invitations.find((i) => i.id === previous.invitationId);
        if (replayed) return toInvitationView(db, replayed, true);
      }
      enforceEmailFree(db, input.email);
      enforceAssignableRole(db, clinic.id, input.roleId);
      const branchIds = enforceAssignableBranches(db, clinic.id, input);
      enforceUserLimit(db, clinic.id);
      const now = Date.now();
      const record: InvitationRecord = {
        id: newId(),
        clinicId: clinic.id,
        email: input.email,
        fullName: input.fullName,
        roleId: input.roleId,
        allBranches: input.allBranches,
        branchIds,
        status: "pending",
        expiresAt: new Date(now + INVITATION_TTL_DAYS * DAY).toISOString(),
        createdAt: new Date(now).toISOString(),
        invitedBy: actorName,
        respondedAt: null,
        tokenHash: "",
      };
      db.invitations.push(record);
      db.idempotentInvites = {
        ...db.idempotentInvites,
        [replayKey]: { invitationId: record.id, fingerprint },
      };
      issueInviteToken(db, record);
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "invitation.sent",
        entity: "invitation",
        before: null,
        after: invitationAuditSnapshot(record),
      });
      persist();
      return toInvitationView(db, record);
    },

    async resend(persona, invitationId) {
      await delay();
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "create", "users");
      const inv = findInvitation(db, clinic.id, invitationId);
      const status = computeInvitationStatus(inv);
      if (status === "cancelled") throw new ApiError("invitation_cancelled");
      if (status === "accepted") throw new ApiError("invitation_used");
      // The role or branches may have been deactivated since sending: re-check before renewing.
      enforceAssignableRole(db, clinic.id, inv.roleId);
      enforceAssignableBranches(db, clinic.id, inv);
      if (status === "expired") {
        // An expired invitation stops counting; renewing it must fit the limit and the email rule again.
        enforceEmailFree(db, inv.email, inv.id);
        enforceUserLimit(db, clinic.id);
      }
      const before = invitationAuditSnapshot(inv);
      inv.expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * DAY).toISOString();
      // A resend issues a new link; the previous one stops working.
      issueInviteToken(db, inv);
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "invitation.resent",
        entity: "invitation",
        before,
        after: invitationAuditSnapshot(inv),
      });
      persist();
      return toInvitationView(db, inv);
    },

    async cancel(persona, invitationId) {
      await delay();
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "deactivate", "users");
      const inv = findInvitation(db, clinic.id, invitationId);
      const status = computeInvitationStatus(inv);
      if (status === "accepted") throw new ApiError("invitation_used");
      if (status === "cancelled") return toInvitationView(db, inv);
      const before = invitationAuditSnapshot(inv);
      inv.status = "cancelled";
      inv.respondedAt = new Date().toISOString();
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "invitation.cancelled",
        entity: "invitation",
        before,
        after: invitationAuditSnapshot(inv),
      });
      persist();
      return toInvitationView(db, inv);
    },

    async preview(token) {
      await delay(80);
      const db = getState();
      const inv = findInvitationByToken(db, token);
      if (!inv) throw new ApiError("not_found");
      const clinic = db.clinics.find((c) => c.id === inv.clinicId);
      const role = db.roles.find((r) => r.id === inv.roleId);
      if (!clinic) throw new ApiError("not_found");
      const status = computeInvitationStatus(inv);
      // A token that can no longer be accepted reveals its status only, never the invitee's details.
      if (status !== "pending") {
        return {
          clinicNameAr: "",
          clinicNameEn: "",
          roleNameAr: "",
          roleNameEn: "",
          fullName: "",
          email: "",
          status,
        };
      }
      return {
        clinicNameAr: clinic.nameAr,
        clinicNameEn: clinic.nameEn,
        roleNameAr: role?.nameAr ?? "",
        roleNameEn: role?.nameEn ?? "",
        fullName: inv.fullName,
        email: inv.email,
        status,
      };
    },

    async accept(token, rawInput) {
      await delay();
      // Mock only: the password is validated and then discarded; nothing but the status is stored.
      if (!acceptInvitationInputSchema.safeParse(rawInput).success)
        throw new ApiError("validation");
      const db = getState();
      const inv = usableInvitation(db, token);
      // Re-run the invite-time guards: the clinic, role, branches or email may have changed since.
      const clinic = db.clinics.find((c) => c.id === inv.clinicId);
      if (!clinic) throw new ApiError("not_found");
      if (clinicBlockReason(clinic)) throw new ApiError("subscription_blocked");
      enforceEmailFree(db, inv.email, inv.id);
      enforceAssignableRole(db, inv.clinicId, inv.roleId);
      enforceAssignableBranches(db, inv.clinicId, inv);
      const now = new Date().toISOString();
      const before = invitationAuditSnapshot(inv);
      inv.status = "accepted";
      inv.respondedAt = now;
      const member: MembershipUser = {
        id: newId(),
        userId: newId(),
        clinicId: inv.clinicId,
        fullName: inv.fullName,
        email: inv.email,
        roleId: inv.roleId,
        allBranches: inv.allBranches,
        branchIds: [...inv.branchIds],
        status: "active",
        preferredLanguage: clinic.defaultLanguage,
        lastLoginAt: null,
        createdAt: now,
      };
      db.members.push(member);
      const base = { clinicId: inv.clinicId, actorName: inv.fullName };
      writeClinicAudit(db, {
        ...base,
        action: "invitation.accepted",
        entity: "invitation",
        before,
        after: invitationAuditSnapshot(inv),
      });
      writeClinicAudit(db, {
        ...base,
        action: "user.created",
        entity: "user",
        before: null,
        after: member,
      });
      delete db.inviteOutbox[inv.id];
      persist();
      const roleKey = db.roles.find((r) => r.id === inv.roleId)?.systemKey ?? null;
      return { clinicId: inv.clinicId, memberId: member.id, roleKey };
    },
  };
}
