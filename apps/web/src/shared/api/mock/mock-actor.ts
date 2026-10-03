import type { Clinic } from "@eyadex/contracts/clinics";
import type { Role } from "@eyadex/contracts/organization";
import {
  PERMISSION_CATALOG,
  type PermissionAction,
  type PermissionResource,
} from "@eyadex/contracts/permissions";
import type { Persona } from "@eyadex/contracts/session";
import type { MembershipUser } from "@eyadex/contracts/users";
import { ApiError } from "../api-error";
import type { MockState } from "./mock-store";

export type Actor = { clinic: Clinic; member: MembershipUser; role: Role };

export function clinicBlockReason(clinic: Clinic): "suspended" | "expired" | null {
  if (clinic.status === "suspended") return "suspended";
  if (new Date(clinic.expiresAt).getTime() < Date.now()) return "expired";
  return null;
}

/** Finds the signed-in clinic account. A deactivated account ends the session (story 63). */
export function resolveActor(db: MockState, persona: Persona): Actor {
  if (persona.kind === "platform_admin" || !persona.clinicId) throw new ApiError("forbidden");
  const clinic = db.clinics.find((c) => c.id === persona.clinicId);
  if (!clinic) throw new ApiError("not_found");
  const member = persona.memberId
    ? db.members.find((m) => m.clinicId === clinic.id && m.id === persona.memberId)
    : db.members.find((m) => {
        const role = db.roles.find((r) => r.id === m.roleId);
        return (
          m.clinicId === clinic.id && m.status === "active" && role?.systemKey === persona.kind
        );
      });
  if (!member) throw new ApiError("not_found");
  if (member.status !== "active") throw new ApiError("account_disabled");
  const role = db.roles.find((r) => r.clinicId === clinic.id && r.id === member.roleId);
  if (!role) throw new ApiError("forbidden");
  return { clinic, member, role };
}

/** Effective permissions of the account: inactive roles grant nothing, disabled modules are removed. */
export function effectivePermissions(db: MockState, actor: Actor): string[] {
  if (!actor.role.isActive) return [];
  const features = db.features[actor.clinic.id] ?? { patients: false };
  return actor.role.permissions.filter((key) => {
    const def = PERMISSION_CATALOG.find((p) => p.key === key);
    return def && (def.module === null || features[def.module]);
  });
}

/**
 * Check order: active user -> clinic access (subscription) -> module enabled -> role permission.
 * Branch scope is not used by clinic-scoped resources.
 */
export function authorize(
  db: MockState,
  persona: Persona,
  action: PermissionAction,
  resource: PermissionResource,
): Actor & { actorName: string } {
  const actor = resolveActor(db, persona);
  if (clinicBlockReason(actor.clinic)) throw new ApiError("subscription_blocked");
  const def = PERMISSION_CATALOG.find((p) => p.resource === resource);
  const features = db.features[actor.clinic.id] ?? { patients: false };
  if (def?.module && !features[def.module]) throw new ApiError("module_disabled");
  if (!effectivePermissions(db, actor).includes(`${action}:${resource}:clinic`))
    throw new ApiError("forbidden");
  return { ...actor, actorName: actor.member.fullName };
}
