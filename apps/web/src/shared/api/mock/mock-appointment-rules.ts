import {
  appointmentSlotProblems,
  type SlotProblem,
  type TimeSpan,
} from "@eyadex/contracts/appointment-slots";
import type { Appointment } from "@eyadex/contracts/appointments";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../api-error";
import { effectivePermissions, memberBranchScope, type Actor } from "./mock-actor";
import { writeClinicAudit } from "./mock-audit";
import {
  guardAppointments,
  profileOf,
  reachCovers,
  worksIn,
  type Reach,
} from "./mock-scheduling-rules";
import type { MockState, StoredAppointment } from "./mock-store";

// The API's appointments rules for the mock (slice A2, ADR-0026 §11), in the API's order.

type Action = "view" | "create" | "update" | "overbook";
export type AppointmentAccess = Actor & {
  actorName: string;
  keys: readonly string[];
  memberReach: Reach;
  reach: (action: Action) => Reach;
  /** A3: the caller's membership when its widest view key is `own`, else null (a wider key wins). */
  own: string | null;
  /** The branches whose day it may open: the view reach, or under `own` its own branches. */
  dayReach: Reach;
};

/**
 * The route's guards in the API's order: active user → clinic access → module → the route's key
 * (`view|create|update:appointments` at clinic or branch scope, and `view` also at `own`, A3), then
 * the action's reach.
 */
export function authorizeAppointments(
  db: MockState,
  persona: Persona,
  action: "view" | "create" | "update",
): AppointmentAccess {
  const actor = guardAppointments(db, persona);
  const keys = effectivePermissions(db, actor);
  const scope = memberBranchScope(db, actor.member);
  const memberReach: Reach = scope.allBranches
    ? { all: true }
    : { all: false, branchIds: scope.branchIds };
  const reach = (a: Action): Reach => {
    if (keys.includes(`${a}:appointments:clinic`)) return { all: true };
    if (keys.includes(`${a}:appointments:branch`)) return memberReach;
    return { all: false, branchIds: [] };
  };
  const route = reach(action);
  const wide = route.all || keys.includes(`${action}:appointments:branch`);
  const viewWide = reach("view").all || keys.includes("view:appointments:branch");
  const own = !viewWide && keys.includes("view:appointments:own") ? actor.member.id : null;
  if (!wide && !(action === "view" && own !== null)) throw new ApiError("forbidden");
  const dayReach = own === null ? reach("view") : memberReach;
  return { ...actor, actorName: actor.member.fullName, keys, memberReach, reach, own, dayReach };
}

/** Does the caller's view see this appointment: by branch, or under `own` when it is the provider. */
export const sees = (a: AppointmentAccess, s: StoredAppointment): boolean =>
  a.own === null ? reachCovers(a.reach("view"), s.branchId) : s.providerMembershipId === a.own;

/** The branch inside the action's reach, and the overbook key there when asked (before any rule). */
export function assertMay(
  a: AppointmentAccess,
  action: "create" | "update",
  branchId: string,
  overbook: boolean,
): void {
  if (!reachCovers(a.reach(action), branchId)) throw new ApiError("forbidden");
  if (overbook && !reachCovers(a.reach("overbook"), branchId)) throw new ApiError("forbidden");
}

/** Rules 1 and 7 and the checks overbook never lifts, in the API's order. */
export function checkTarget(
  db: MockState,
  clinicId: string,
  target: {
    providerId: string;
    branchId: string;
    patientId: string | null;
    serviceId: string | null;
  },
) {
  const provider = db.members.find((m) => m.clinicId === clinicId && m.id === target.providerId);
  if (!provider) throw new ApiError("not_found");
  const profile = profileOf(db, provider.id);
  if (provider.status !== "active" || !profile.acceptsAppointments) {
    throw new ApiError("provider_not_bookable");
  }
  if (target.patientId !== null) {
    const patient = db.patients.find((p) => p.clinicId === clinicId && p.id === target.patientId);
    if (!patient) throw new ApiError("not_found");
    if (patient.status !== "active") throw new ApiError("patient_inactive");
  }
  const branch = db.branches.find((b) => b.clinicId === clinicId && b.id === target.branchId);
  if (!branch) throw new ApiError("not_found");
  if (!branch.isActive) throw new ApiError("branch_inactive");
  if (!worksIn(provider, target.branchId)) throw new ApiError("provider_not_in_branch");
  if (target.serviceId === null) return { provider, profile, service: null };
  const service = db.services.find((s) => s.clinicId === clinicId && s.id === target.serviceId);
  if (!service) throw new ApiError("not_found");
  if (service.status !== "active") throw new ApiError("service_inactive");
  return { provider, profile, service };
}

const overlaps = (a: TimeSpan, b: TimeSpan) =>
  Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);

/** Rule 2 on the provider's rows of THIS branch, its time off and its other live appointments. */
export function slotProblems(
  db: MockState,
  a: AppointmentAccess,
  target: { providerId: string; branchId: string },
  span: TimeSpan,
  exceptId: string | null,
): SlotProblem[] {
  const clinicId = a.clinic.id;
  const rows = db.scheduleRows.filter(
    (r) =>
      r.clinicId === clinicId &&
      r.membershipId === target.providerId &&
      r.branchId === target.branchId,
  );
  const off = db.timeOff.filter(
    (t) =>
      t.clinicId === clinicId && t.membershipId === target.providerId && t.cancelledAt === null,
  );
  const busy = db.appointments.filter(
    (x) =>
      x.clinicId === clinicId &&
      x.providerMembershipId === target.providerId &&
      x.status !== "cancelled" &&
      x.id !== exceptId &&
      overlaps(x, span),
  );
  return appointmentSlotProblems(span, a.clinic.timezone, rows, off, busy);
}

/** A stored appointment as the contract's view (names read now, never the phone). */
export function project(db: MockState, s: StoredAppointment): Appointment {
  const provider = db.members.find((m) => m.id === s.providerMembershipId);
  const patient = db.patients.find((p) => p.id === s.patientId);
  const service = s.serviceId === null ? undefined : db.services.find((x) => x.id === s.serviceId);
  return {
    id: s.id,
    branchId: s.branchId,
    providerMembershipId: s.providerMembershipId,
    providerName: provider?.fullName ?? "",
    patientId: s.patientId,
    patientName: patient?.fullName ?? "",
    patientFileNumber: patient?.fileNumber ?? 0,
    serviceId: s.serviceId,
    serviceNameAr: service?.nameAr ?? null,
    serviceNameEn: service?.nameEn ?? null,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    status: s.status,
    overbooked: s.overbooked,
    cancelReason: s.cancelReason,
    cancelNote: s.cancelNote,
  };
}

/** The write answer clipped to the view keys (ADR-0026 §11; under `own` the caller's own, A3). */
export const answer = (db: MockState, a: AppointmentAccess, s: StoredAppointment) => ({
  appointment: sees(a, s) ? project(db, s) : null,
});

/** Rule 9: the API's allowlisted snapshot — no patient, no note. */
function snapshot(db: MockState, s: StoredAppointment) {
  const v = project(db, s);
  return {
    id: s.id,
    providerName: v.providerName,
    branchId: s.branchId,
    serviceNameAr: v.serviceNameAr,
    serviceNameEn: v.serviceNameEn,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    status: s.status,
    overbooked: s.overbooked,
    cancelReason: s.cancelReason,
  };
}

export function auditAppointment(
  db: MockState,
  a: AppointmentAccess,
  action: string,
  before: StoredAppointment | null,
  after: StoredAppointment,
): void {
  writeClinicAudit(db, {
    clinicId: a.clinic.id,
    actorName: a.actorName,
    action,
    entity: "appointment",
    before: before === null ? null : snapshot(db, before),
    after: snapshot(db, after),
  });
}
