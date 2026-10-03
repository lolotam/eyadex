import {
  changeBranchesInputSchema,
  changeRoleInputSchema,
  userListQuerySchema,
  type MembershipUser,
} from "@contracts/users";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { authorize } from "./mock-actor";
import { writeClinicAudit } from "./mock-audit";
import { delay, getState, persist, type MockState } from "./mock-store";
import {
  enforceAssignableBranches,
  enforceAssignableRole,
  enforceNotLastAdmin,
  enforceUserLimit,
  paginate,
  toUserView,
  userUsage,
} from "./mock-user-rules";

function findMember(db: MockState, clinicId: string, id: string): MembershipUser {
  const member = db.members.find((m) => m.clinicId === clinicId && m.id === id);
  if (!member) throw new ApiError("not_found");
  return member;
}

export function createMockUsers(): ApiClient["users"] {
  return {
    async list(persona, rawQuery) {
      await delay();
      const parsed = userListQuerySchema.safeParse(rawQuery);
      if (!parsed.success) throw new ApiError("validation");
      const query = parsed.data;
      const db = getState();
      const { clinic } = authorize(db, persona, "view", "users");
      const term = query.search.toLocaleLowerCase();
      const rows = db.members
        .filter((m) => m.clinicId === clinic.id)
        .filter((m) => !query.status || m.status === query.status)
        .filter((m) => !query.roleId || m.roleId === query.roleId)
        .filter(
          (m) => !query.branchId || m.allBranches || m.branchIds.includes(query.branchId ?? ""),
        )
        .filter(
          (m) =>
            !term ||
            m.fullName.toLocaleLowerCase().includes(term) ||
            m.email.toLocaleLowerCase().includes(term),
        )
        .sort(
          (a, b) =>
            Number(b.status === "active") - Number(a.status === "active") ||
            a.fullName.localeCompare(b.fullName),
        )
        .map((m) => toUserView(db, m));
      return paginate(rows, query.cursor, query.limit);
    },

    async usage(persona) {
      await delay(80);
      const db = getState();
      const { clinic } = authorize(db, persona, "view", "users");
      return userUsage(db, clinic.id);
    },

    async listRoleOptions(persona) {
      await delay(80);
      const db = getState();
      const { clinic } = authorize(db, persona, "view", "users");
      return db.roles
        .filter((r) => r.clinicId === clinic.id)
        .map(({ id, nameAr, nameEn, isActive }) => ({ id, nameAr, nameEn, isActive }));
    },

    async listBranchOptions(persona) {
      await delay(80);
      const db = getState();
      const { clinic } = authorize(db, persona, "view", "users");
      return db.branches
        .filter((b) => b.clinicId === clinic.id)
        .map(({ id, nameAr, nameEn, isActive }) => ({ id, nameAr, nameEn, isActive }));
    },

    async changeRole(persona, memberId, rawInput) {
      await delay();
      const parsed = changeRoleInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new ApiError("validation");
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "update", "users");
      const member = findMember(db, clinic.id, memberId);
      if (member.roleId === parsed.data.roleId) return toUserView(db, member);
      enforceAssignableRole(db, clinic.id, parsed.data.roleId);
      enforceNotLastAdmin(db, member);
      const before = { ...member };
      member.roleId = parsed.data.roleId;
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "user.role_changed",
        entity: "user",
        before,
        after: member,
      });
      persist();
      return toUserView(db, member);
    },

    async changeBranches(persona, memberId, rawInput) {
      await delay();
      const parsed = changeBranchesInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new ApiError("validation");
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "update", "users");
      const member = findMember(db, clinic.id, memberId);
      const branchIds = enforceAssignableBranches(db, clinic.id, parsed.data);
      const before = { ...member, branchIds: [...member.branchIds] };
      member.allBranches = parsed.data.allBranches;
      member.branchIds = branchIds;
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "user.branches_changed",
        entity: "user",
        before,
        after: member,
      });
      persist();
      return toUserView(db, member);
    },

    async deactivate(persona, memberId) {
      await delay();
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "deactivate", "users");
      const member = findMember(db, clinic.id, memberId);
      if (member.status === "deactivated") return toUserView(db, member);
      enforceNotLastAdmin(db, member);
      const before = { ...member };
      member.status = "deactivated";
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "user.deactivated",
        entity: "user",
        before,
        after: member,
      });
      persist();
      return toUserView(db, member);
    },

    async reactivate(persona, memberId) {
      await delay();
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "deactivate", "users");
      const member = findMember(db, clinic.id, memberId);
      if (member.status === "active") return toUserView(db, member);
      enforceUserLimit(db, clinic.id);
      // A role or branch may have been deactivated while the account was off; reactivating must
      // not create an active account whose access points only at inactive assignments.
      enforceAssignableRole(db, clinic.id, member.roleId);
      enforceAssignableBranches(db, clinic.id, {
        allBranches: member.allBranches,
        branchIds: member.branchIds,
      });
      const before = { ...member };
      member.status = "active";
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "user.reactivated",
        entity: "user",
        before,
        after: member,
      });
      persist();
      return toUserView(db, member);
    },
  };
}
