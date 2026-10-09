import { NO_FEATURES } from "@eyadex/contracts/clinics";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../api-error";
import { clinicBlockReason, effectivePermissions, resolveActor, type Actor } from "./mock-actor";
import type { MockState, StoredShift } from "./mock-store";

/** Every branch, or a branch list: the reach of one action (as the API's `Reach`). */
export type Reach = { all: true } | { all: false; branchIds: readonly string[] };
export type SchedulingAccess = Actor & { actorName: string; reach: Reach };
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
  const base = { ...actor, actorName: actor.member.fullName };
  if (keys.includes(`${action}:schedules:clinic`)) return { ...base, reach: { all: true } };
  if (!clinicOnly && keys.includes(`${action}:schedules:branch`)) {
    const { allBranches, branchIds } = actor.member;
    return { ...base, reach: allBranches ? { all: true } : { all: false, branchIds } };
  }
  throw new ApiError("forbidden");
}

export const reachCovers = (reach: Reach, branchId: string) =>
  reach.all || reach.branchIds.includes(branchId);

export function providerWithin(reach: Reach, member: MemberReach): boolean {
  if (reach.all) return true;
  if (member.allBranches) return reach.branchIds.length > 0;
  return member.branchIds.some((id) => reach.branchIds.includes(id));
}

export const worksIn = (member: MemberReach, branchId: string) =>
  member.allBranches || member.branchIds.includes(branchId);

export const shiftLabel = (s: Pick<StoredShift, "weekday" | "startsAt" | "endsAt">) =>
  `${s.weekday} ${s.startsAt}-${s.endsAt}`;

export const profileOf = (db: MockState, memberId: string) =>
  db.bookingProfiles[memberId] ?? { acceptsAppointments: false, defaultDurationMinutes: 20 };
