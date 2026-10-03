import type { ClinicFeatures } from "@contracts/clinics";
import type { Role } from "@contracts/organization";
import { PERMISSION_CATALOG, type PermissionDefinition } from "@contracts/permissions";
import type { RoleListItem } from "@contracts/roles";
import { ApiError } from "../api-error";
import type { MockState } from "./mock-store";

export function findRole(db: MockState, clinicId: string, roleId: string): Role {
  const role = db.roles.find((r) => r.clinicId === clinicId && r.id === roleId);
  if (!role) throw new ApiError("not_found");
  return role;
}

export function memberCount(db: MockState, role: Role): number {
  return db.members.filter(
    (m) => m.clinicId === role.clinicId && m.roleId === role.id && m.status === "active",
  ).length;
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
