import { NO_FEATURES } from "@eyadex/contracts/clinics";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../api-error";
import { clinicBlockReason, effectivePermissions, resolveActor, type Actor } from "./mock-actor";
import type { MockState, StoredShift } from "./mock-store";

/** Every branch, or a branch list: the reach of one action (as the API's `Reach`). */
export type Reach = { all: true } | { all: false; branchIds: readonly string[] };
/** `reach` is the action's; `viewReach` (the view keys') clips every schedule the mock answers with. */
export type SchedulingAccess = Actor & { actorName: string; reach: Reach; viewReach: Reach };
type MemberReach = { allBranches: boolean; branchIds: readonly string[] };

/** The action-independent guards, in the API's order: active user, clinic access, module. */
export function guardAppointments(db: MockState, persona: Persona): Actor {
  const actor = resolveActor(db, persona);
  if (clinicBlockReason(actor.clinic)) throw new ApiError("subscription_blocked");
  if (!(db.features[actor.clinic.id] ?? NO_FEATURES).appointments) {
    throw new ApiError("module_disabled");
  }
  return actor;
}

/** A schedules action at its scope: the clinic key reaches every branch, the branch key the member's. */
export function authorizeSchedules(
  db: MockState,
  persona: Persona,
  action: "view" | "update",
  clinicOnly = false,
): SchedulingAccess {
  const actor = guardAppointments(db, persona);
  const keys = effectivePermissions(db, actor);
  const { allBranches, branchIds } = actor.member;
  const own: Reach = allBranches ? { all: true } : { all: false, branchIds };
  const viewReach: Reach = keys.includes("view:schedules:clinic")
    ? { all: true }
    : keys.includes("view:schedules:branch")
      ? own
      : { all: false, branchIds: [] };
  const base = { ...actor, actorName: actor.member.fullName, viewReach };
  if (keys.includes(`${action}:schedules:clinic`)) return { ...base, reach: { all: true } };
  if (!clinicOnly && keys.includes(`${action}:schedules:branch`)) return { ...base, reach: own };
  throw new ApiError("forbidden");
}

export const reachCovers = (reach: Reach, branchId: string) =>
  reach.all || reach.branchIds.includes(branchId);

export function providerWithin(reach: Reach, member: MemberReach): boolean {
  if (reach.all) return true;
  if (member.allBranches) return reach.branchIds.length > 0;
  return member.branchIds.some((id) => reach.branchIds.includes(id));
}

/** A provider's branches as the caller may see them: never outside a branch-scope reach (as the API). */
export function branchesWithin(reach: Reach, member: MemberReach): MemberReach {
  if (reach.all) return { allBranches: member.allBranches, branchIds: [...member.branchIds] };
  const branchIds = member.allBranches
    ? [...reach.branchIds]
    : member.branchIds.filter((id) => reach.branchIds.includes(id));
  return { allBranches: false, branchIds };
}

export const worksIn = (member: MemberReach, branchId: string) =>
  member.allBranches || member.branchIds.includes(branchId);

export const shiftLabel = (s: Pick<StoredShift, "weekday" | "startsAt" | "endsAt">) =>
  `${s.weekday} ${s.startsAt}-${s.endsAt}`;

export const profileOf = (db: MockState, memberId: string) =>
  db.bookingProfiles[memberId] ?? { acceptsAppointments: false, defaultDurationMinutes: 20 };
