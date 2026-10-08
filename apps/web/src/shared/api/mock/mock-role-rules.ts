import type { ClinicFeatures } from "@eyadex/contracts/clinics";
import type { Role } from "@eyadex/contracts/organization";
import { PERMISSION_CATALOG, type PermissionDefinition } from "@eyadex/contracts/permissions";
import type { RoleListItem } from "@eyadex/contracts/roles";
import { ApiError } from "../api-error";
import { effectivePermissions, type Actor } from "./mock-actor";
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

/**
 * The granting bound (ADR-0017), the API's `keysBeyondActor`: every path that grants a role (create
 * and update add keys; role reactivation, change role, invite, resend / copy link and member
 * reactivation grant the whole role) may only grant effective keys the actor holds. A clinic-scope
 * key covers the same action at branch scope; a key of a switched-off module has no effect and is
 * not counted. The clinic admin holds every key at clinic scope.
 */
export function enforceGrantable(
  db: MockState,
  actor: Actor,
  granted: readonly string[],
  alreadyGranted: readonly string[],
): void {
  const flags = features(db, actor.clinic.id);
  const held = new Set(effectivePermissions(db, actor));
  const covered = (key: string) => {
    const [action, resource] = key.split(":");
    return held.has(key) || held.has(`${action}:${resource}:clinic`);
  };
  const effective = (key: string) =>
    isVisible(
      PERMISSION_CATALOG.find((p) => p.key === key),
      flags,
    );
  if (granted.some((key) => effective(key) && !alreadyGranted.includes(key) && !covered(key))) {
    throw new ApiError("forbidden");
  }
}

/** The bound for a whole role, granted from nothing (assign, invite, link, reactivations). */
export function enforceGrantableRole(db: MockState, actor: Actor, roleId: string): void {
  enforceGrantable(db, actor, findRole(db, actor.clinic.id, roleId).permissions, []);
}
