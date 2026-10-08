import type { ClinicFeatures } from "@eyadex/contracts/clinics";
import type { Role } from "@eyadex/contracts/organization";
import { PERMISSION_CATALOG, type PermissionDefinition } from "@eyadex/contracts/permissions";
import type { RoleListItem } from "@eyadex/contracts/roles";
import { ApiError } from "../api-error";
import type { Actor } from "./mock-actor";
import type { MockState } from "./mock-store";

export function findRole(db: MockState, clinicId: string, roleId: string): Role {
  const role = db.roles.find((r) => r.clinicId === clinicId && r.id === roleId);
  if (!role) throw new ApiError("not_found");
  return role;
}

/** Every membership on the role, deactivated ones included: they must be reassigned first. */
export function memberCount(db: MockState, role: Role): number {
  return db.members.filter((m) => m.clinicId === role.clinicId && m.roleId === role.id).length;
}

export function toRoleListItem(db: MockState, role: Role): RoleListItem {
  return {
    id: role.id,
    systemKey: role.systemKey,
    nameAr: role.nameAr,
    nameEn: role.nameEn,
    isLocked: role.isLocked,
    isActive: role.isActive,
    memberCount: memberCount(db, role),
    permissionKeys: [...role.permissions],
  };
}

/** Audit snapshot: names, status and keys only. */
export function roleSnapshot(role: Role) {
  return {
    id: role.id,
    nameAr: role.nameAr,
    nameEn: role.nameEn,
    isActive: role.isActive,
    permissionKeys: [...role.permissions],
  };
}

function features(db: MockState, clinicId: string): ClinicFeatures {
  return db.features[clinicId] ?? { patients: false };
}

function isVisible(def: PermissionDefinition | undefined, flags: ClinicFeatures): boolean {
  return Boolean(def && (def.module === null || flags[def.module]));
}

/** The editor catalog: keys of switched-off modules are hidden. */
export function visibleCatalog(db: MockState, clinicId: string): PermissionDefinition[] {
  const flags = features(db, clinicId);
  return PERMISSION_CATALOG.filter((def) => isVisible(def, flags));
}

/**
 * Keys of a switched-off module cannot be edited: the saved role keeps its existing hidden keys
 * untouched so turning the module back on restores them (PRD 4.8).
 */
export function mergeHiddenKeys(
  db: MockState,
  clinicId: string,
  requested: string[],
  existing: string[],
): string[] {
  const flags = features(db, clinicId);
  const visible = (key: string) =>
    isVisible(
      PERMISSION_CATALOG.find((p) => p.key === key),
      flags,
    );
  return [...requested.filter(visible), ...existing.filter((key) => !visible(key))];
}

export function enforceUniqueNames(
  db: MockState,
  clinicId: string,
  names: { nameAr: string; nameEn: string },
  ignoreRoleId?: string,
): void {
  const ar = names.nameAr.toLocaleLowerCase();
  const en = names.nameEn.toLocaleLowerCase();
  const taken = db.roles.some(
    (r) =>
      r.clinicId === clinicId &&
      r.id !== ignoreRoleId &&
      (r.nameAr.toLocaleLowerCase() === ar || r.nameEn.toLocaleLowerCase() === en),
  );
  if (taken) throw new ApiError("role_name_taken");
}

export function enforceNotLocked(role: Role): void {
  if (role.isLocked) throw new ApiError("role_locked");
}

type Reach = { allBranches: boolean; branchIds: readonly string[] };

/** The API's `uncoveredKeys`: stored keys of every module; a clinic key covers its branch scope. */
function covers(held: readonly string[], key: string): boolean {
  const [action, resource] = key.split(":");
  return held.includes(key) || held.includes(`${action}:${resource}:clinic`);
}

/** The actor's reach: every branch, or its active branches only. */
function actorReach(db: MockState, actor: Actor): Reach {
  if (actor.member.allBranches) return { allBranches: true, branchIds: [] };
  const active = new Set(db.branches.filter((b) => b.isActive).map((b) => b.id));
  return { allBranches: false, branchIds: actor.member.branchIds.filter((id) => active.has(id)) };
}

function within(target: Reach, actor: Reach): boolean {
  if (actor.allBranches) return true;
  if (target.allBranches) return false;
  return target.branchIds.every((id) => actor.branchIds.includes(id));
}

/**
 * Role definition writes (create, update, deactivate, reactivate), as the API decides them (ADR-0017
 * §6): an active, all-branch actor whose stored role keys — every module, switched-off ones too —
 * cover the role's keys. TODO(spec): a looser delegation model needs an owner decision.
 */
export function enforceMayDefineRole(db: MockState, actor: Actor, roleKeys: readonly string[]) {
  const usable = actor.member.status === "active" && actor.role.isActive;
  if (!usable || !actorReach(db, actor).allBranches) throw new ApiError("forbidden");
  if (roleKeys.some((key) => !covers(actor.role.permissions, key))) throw new ApiError("forbidden");
}

/**
 * Role grants (change role or branches, invite, resend, copy link, member reactivation): the
 * actor's stored keys cover the role's, and the target's branch scope sits inside the actor's.
 */
export function enforceMayGrantRole(db: MockState, actor: Actor, roleId: string, target: Reach) {
  const role = findRole(db, actor.clinic.id, roleId);
  const usable = actor.member.status === "active" && actor.role.isActive;
  if (!usable || role.permissions.some((key) => !covers(actor.role.permissions, key))) {
    throw new ApiError("forbidden");
  }
  if (!within(target, actorReach(db, actor))) throw new ApiError("forbidden");
}
