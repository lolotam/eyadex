import {
  acceptInvitationInputSchema,
  computeInvitationStatus,
  INVITATION_TTL_DAYS,
  invitationListQuerySchema,
  type InvitationRecord,
} from "@contracts/invitations";
import { inviteUserInputSchema, type MembershipUser } from "@contracts/users";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { authorize } from "./mock-actor";
import { writeClinicAudit } from "./mock-audit";
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
  const inv = db.invitations.find((i) => i.id === token);
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
      const { clinic } = authorize(db, persona, "view", "users");
      const term = query.search.toLocaleLowerCase();
      const rows = db.invitations
        .filter((i) => i.clinicId === clinic.id)
        .map((i) => toInvitationView(db, i))
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

    async invite(persona, rawInput) {
      await delay();
      const parsed = inviteUserInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new ApiError("validation");
      const input = parsed.data;
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "create", "users");
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
      };
      db.invitations.push(record);
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "invitation.sent",
        entity: "invitation",
        before: null,
        after: record,
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
      if (status === "expired") {
        // An expired invitation stops counting; renewing it must fit the limit and the email rule again.
        enforceEmailFree(db, inv.email, inv.id);
        enforceUserLimit(db, clinic.id);
      }
      const before = { ...inv };
      inv.expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * DAY).toISOString();
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "invitation.resent",
        entity: "invitation",
        before,
        after: inv,
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
      const before = { ...inv };
      inv.status = "cancelled";
      inv.respondedAt = new Date().toISOString();
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "invitation.cancelled",
        entity: "invitation",
        before,
        after: inv,
      });
      persist();
      return toInvitationView(db, inv);
    },

    async preview(token) {
      await delay(80);
      const db = getState();
      const inv = db.invitations.find((i) => i.id === token);
      if (!inv) throw new ApiError("not_found");
      const clinic = db.clinics.find((c) => c.id === inv.clinicId);
      const role = db.roles.find((r) => r.id === inv.roleId);
      if (!clinic) throw new ApiError("not_found");
      return {
        clinicNameAr: clinic.nameAr,
        clinicNameEn: clinic.nameEn,
        roleNameAr: role?.nameAr ?? "",
        roleNameEn: role?.nameEn ?? "",
        fullName: inv.fullName,
        email: inv.email,
        status: computeInvitationStatus(inv),
      };
    },

    async accept(token, rawInput) {
      await delay();
      // Mock only: the password is validated and then discarded; nothing but the status is stored.
      if (!acceptInvitationInputSchema.safeParse(rawInput).success)
        throw new ApiError("validation");
      const db = getState();
      const inv = usableInvitation(db, token);
      if (db.members.some((m) => m.email.toLowerCase() === inv.email.toLowerCase()))
        throw new ApiError("email_taken");
      const now = new Date().toISOString();
      const before = { ...inv };
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
        preferredLanguage: "ar",
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
        after: inv,
      });
      writeClinicAudit(db, {
        ...base,
        action: "user.created",
        entity: "user",
        before: null,
        after: member,
      });
      persist();
      const roleKey = db.roles.find((r) => r.id === inv.roleId)?.systemKey ?? null;
      return { clinicId: inv.clinicId, memberId: member.id, roleKey };
    },
  };
}
