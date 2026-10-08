import type { Role } from "@eyadex/contracts/organization";
import { roleInputSchema, type RoleInput } from "@eyadex/contracts/roles";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { authorize, effectivePermissions, type Actor } from "./mock-actor";
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

/**
 * TODO(spec) (ADR-0017 rule 8): a write may only ADD keys the actor holds itself, as the API does;
 * a clinic-scope key covers the same action at branch scope. Keeping or removing keys is not
 * restricted. The clinic admin holds every key at clinic scope.
 */
function enforceGrantable(db: MockState, actor: Actor, saved: string[], existing: string[]): void {
  const held = new Set(effectivePermissions(db, actor));
  const covered = (key: string) => {
    const [action, resource] = key.split(":");
    return held.has(key) || held.has(`${action}:${resource}:clinic`);
  };
  if (saved.some((key) => !existing.includes(key) && !covered(key))) {
    throw new ApiError("forbidden");
  }
}

/** The same key must carry the same request; a key set is a set, so its order does not count. */
const fingerprintOf = (input: RoleInput) =>
  JSON.stringify({ ...input, permissionKeys: [...input.permissionKeys].sort() });

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

function setActive(
  persona: Parameters<ApiClient["roles"]["deactivate"]>[0],
  roleId: string,
  active: boolean,
) {
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
        .sort(
          (a, b) =>
            Number(b.isLocked) - Number(a.isLocked) || Number(b.isActive) - Number(a.isActive),
        )
        .map((r) => toRoleListItem(db, r));
    },

    async catalog(persona) {
      await delay(60);
      const db = getState();
      const { clinic } = authorize(db, persona, "view", "roles");
      return visibleCatalog(db, clinic.id);
    },

    async create(persona, rawInput, idempotencyKey) {
      await delay();
      const db = getState();
      const actor = authorize(db, persona, "create", "roles");
      const { clinic, actorName } = actor;
      const input = parseInput(rawInput);
      const replayKey = `${clinic.id}:${idempotencyKey}`;
      const previous = db.idempotentRoles?.[replayKey];
      if (previous) {
        if (previous.fingerprint !== fingerprintOf(input))
          throw new ApiError("idempotency_conflict");
        const replayed = db.roles.find((r) => r.id === previous.roleId);
        if (replayed) return toRoleListItem(db, replayed);
      }
      enforceUniqueNames(db, clinic.id, input);
      const permissions = mergeHiddenKeys(db, clinic.id, input.permissionKeys, []);
      enforceGrantable(db, actor, permissions, []);
      const role: Role = {
        id: newId(),
        clinicId: clinic.id,
        systemKey: null,
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        isLocked: false,
        isActive: true,
        permissions,
      };
      db.roles.push(role);
      db.idempotentRoles = {
        ...db.idempotentRoles,
        [replayKey]: { roleId: role.id, fingerprint: fingerprintOf(input) },
      };
      audit(db, clinic.id, actorName, "role.created", null, role);
      persist();
      return toRoleListItem(db, role);
    },

    async update(persona, roleId, rawInput) {
      await delay();
      const db = getState();
      const actor = authorize(db, persona, "update", "roles");
      const { clinic, actorName } = actor;
      const role = findRole(db, clinic.id, roleId);
      enforceNotLocked(role);
      const input = parseInput(rawInput);
      enforceUniqueNames(db, clinic.id, input, role.id);
      const permissions = mergeHiddenKeys(db, clinic.id, input.permissionKeys, role.permissions);
      enforceGrantable(db, actor, permissions, role.permissions);
      const before = structuredClone(role);
      role.nameAr = input.nameAr;
      role.nameEn = input.nameEn;
      role.permissions = permissions;
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
