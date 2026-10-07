import {
  computeInvitationStatus,
  type Invitation,
  type InvitationRecord,
} from "@eyadex/contracts/invitations";
import type { MembershipUser, MembershipUserView, UserUsage } from "@eyadex/contracts/users";
import type { Role } from "@eyadex/contracts/organization";
import { ApiError } from "../api-error";
import type { MockState } from "./mock-store";

export function isLiveInvitation(inv: InvitationRecord, now = Date.now()): boolean {
  return computeInvitationStatus(inv, now) === "pending";
}

/** Active users + pending, non-expired invitations count against the limit. */
export function userUsage(db: MockState, clinicId: string): UserUsage {
  const clinic = db.clinics.find((c) => c.id === clinicId);
  if (!clinic) throw new ApiError("not_found");
  const active = db.members.filter((m) => m.clinicId === clinicId && m.status === "active").length;
  const pending = db.invitations.filter(
    (i) => i.clinicId === clinicId && isLiveInvitation(i),
  ).length;
  return { used: active + pending, limit: clinic.maxUsers };
}

export function enforceUserLimit(db: MockState, clinicId: string): void {
  const usage = userUsage(db, clinicId);
  if (usage.used >= usage.limit) throw new ApiError("limit_reached", undefined, usage);
}

/** One email = one account, across every clinic, invitation and the platform team. */
export function enforceEmailFree(db: MockState, email: string, ignoreInvitationId?: string): void {
  const normalized = email.trim().toLowerCase();
  const taken =
    db.platformAccounts.some((a) => a.email.toLowerCase() === normalized) ||
    db.members.some((m) => m.email.toLowerCase() === normalized) ||
    db.invitations.some(
      (i) =>
        i.id !== ignoreInvitationId && i.email.toLowerCase() === normalized && isLiveInvitation(i),
    );
  if (taken) throw new ApiError("email_taken");
}

export function enforceAssignableRole(db: MockState, clinicId: string, roleId: string): void {
  const role = db.roles.find((r) => r.clinicId === clinicId && r.id === roleId);
  if (!role) throw new ApiError("not_found");
  if (!role.isActive) throw new ApiError("role_inactive");
}

export function enforceAssignableBranches(
  db: MockState,
  clinicId: string,
  access: { allBranches: boolean; branchIds: string[] },
): string[] {
  if (access.allBranches) return [];
  if (access.branchIds.length === 0) throw new ApiError("validation");
  for (const id of access.branchIds) {
    const branch = db.branches.find((b) => b.clinicId === clinicId && b.id === id);
    if (!branch) throw new ApiError("not_found");
    if (!branch.isActive) throw new ApiError("branch_inactive");
  }
  return [...new Set(access.branchIds)];
}

export function isAdminRole(db: MockState, roleId: string): boolean {
  return db.roles.find((r) => r.id === roleId)?.systemKey === "clinic_admin";
}

/** ADM-01: the last active Clinic Admin cannot be deactivated or moved to another role. */
export function enforceNotLastAdmin(db: MockState, member: MembershipUser): void {
  if (member.status !== "active" || !isAdminRole(db, member.roleId)) return;
  const admins = db.members.filter(
    (m) => m.clinicId === member.clinicId && m.status === "active" && isAdminRole(db, m.roleId),
  );
  if (admins.length <= 1) throw new ApiError("last_active_admin");
}

function roleNames(db: MockState, roleId: string) {
  const role = db.roles.find((r) => r.id === roleId);
  return { roleNameAr: role?.nameAr ?? "", roleNameEn: role?.nameEn ?? "" };
}

export function toUserView(db: MockState, member: MembershipUser): MembershipUserView {
  return { ...member, ...roleNames(db, member.roleId) };
}

/** Like the API: views never carry the link token; only `copyLink` returns one. */
export function toInvitationView(db: MockState, record: InvitationRecord): Invitation {
  const { tokenHash: _hash, ...rest } = record;
  return {
    ...rest,
    ...roleNames(db, record.roleId),
    status: computeInvitationStatus(record),
    token: null,
  };
}

export function paginate<T extends { id: string }>(
  rows: T[],
  cursor: string | null,
  limit: number,
): { items: T[]; nextCursor: string | null; total: number } {
  const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0;
  const items = rows.slice(start, start + limit);
  const last = items.at(-1);
  return {
    items,
    total: rows.length,
    nextCursor: start + limit < rows.length && last ? last.id : null,
  };
}

/** ADR-0012 §15: only an active clinic admin may invite to, or act on, the clinic-admin role. */
export function enforceMayTouchAdmin(db: MockState, actorRole: Role, roleId: string): void {
  if (isAdminRole(db, roleId) && actorRole.systemKey !== "clinic_admin") {
    throw new ApiError("forbidden");
  }
}
