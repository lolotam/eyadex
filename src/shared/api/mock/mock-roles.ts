import type { Role } from "@contracts/organization";
import { roleInputSchema, type RoleInput } from "@contracts/roles";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { authorize } from "./mock-actor";
import { writeClinicAudit } from "./mock-audit";
import {
  enforceNotLocked,
  enforceUniqueNames,
  findRole,
  memberCount,
  mergeHiddenKeys,
  roleSnapshot,
  toRoleListItem,
  visibleCatalog,
} from "./mock-role-rules";
import { delay, getState, newId, persist, type MockState } from "./mock-store";

function parseInput(raw: RoleInput) {
  const result = roleInputSchema.safeParse(raw);
  if (!result.success) throw new ApiError("validation");
  return result.data;
}

function audit(
  db: MockState,
  clinicId: string,
  actorName: string,
  action: string,
  before: Role | null,
  after: Role | null,
) {
  writeClinicAudit(db, {
    clinicId,
    actorName,
    action,
    entity: "role",
    before: before ? roleSnapshot(before) : null,
    after: after ? roleSnapshot(after) : null,
  });
}

function setActive(persona: Parameters<ApiClient["roles"]["deactivate"]>[0], roleId: string, active: boolean) {
  const db = getState();
  const { clinic, actorName } = authorize(db, persona, "deactivate", "roles");
  const role = findRole(db, clinic.id, roleId);
  enforceNotLocked(role);
  if (role.isActive === active) return toRoleListItem(db, role);
  if (!active) {
    const count = memberCount(db, role);
    if (count > 0) throw new ApiError("role_in_use", undefined, { count });
  }
  const before = structuredClone(role);
  role.isActive = active;
  audit(db, clinic.id, actorName, active ? "role.reactivated" : "role.deactivated", before, role);
  persist();
  return toRoleListItem(db, role);
}

export function createMockRoles(): ApiClient["roles"] {
  return {
    async list(persona) {
      await delay();
      const db = getState();
      const { clinic } = authorize(db, persona, "view", "roles");
      return db.roles
        .filter((r) => r.clinicId === clinic.id)
        .sort((a, b) => Number(b.isLocked) - Number(a.isLocked) || Number(b.isActive) - Number(a.isActive))
        .map((r) => toRoleListItem(db, r));
    },

    async catalog(persona) {
      await delay(60);
      const db = getState();
      const { clinic } = authorize(db, persona, "view", "roles");
      return visibleCatalog(db, clinic.id);
    },

    async create(persona, rawInput) {
      await delay();
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "create", "roles");
      const input = parseInput(rawInput);
      enforceUniqueNames(db, clinic.id, input);
      const role: Role = {
        id: newId(),
        clinicId: clinic.id,
        systemKey: null,
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        isLocked: false,
        isActive: true,
        permissions: mergeHiddenKeys(db, clinic.id, input.permissionKeys, []),
      };
      db.roles.push(role);
      audit(db, clinic.id, actorName, "role.created", null, role);
      persist();
      return toRoleListItem(db, role);
    },

    async update(persona, roleId, rawInput) {
      await delay();
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "update", "roles");
      const role = findRole(db, clinic.id, roleId);
      enforceNotLocked(role);
      const input = parseInput(rawInput);
      enforceUniqueNames(db, clinic.id, input, role.id);
      const before = structuredClone(role);
      role.nameAr = input.nameAr;
      role.nameEn = input.nameEn;
      role.permissions = mergeHiddenKeys(db, clinic.id, input.permissionKeys, role.permissions);
      audit(db, clinic.id, actorName, "role.updated", before, role);
      persist();
      return toRoleListItem(db, role);
    },

    async deactivate(persona, roleId) {
      await delay();
      return setActive(persona, roleId, false);
    },

    async reactivate(persona, roleId) {
      await delay();
      return setActive(persona, roleId, true);
    },
  };
}
