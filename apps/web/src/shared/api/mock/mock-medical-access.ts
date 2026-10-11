import { NO_FEATURES } from "@eyadex/contracts/clinics";
import type { Persona } from "@eyadex/contracts/session";
import type { z } from "zod";
import { ApiError } from "../api-error";
import {
  clinicBlockReason,
  effectivePermissions,
  memberBranchScope,
  resolveActor,
  type Actor,
} from "./mock-actor";
import { isOwnPatient } from "./mock-own-scope";
import type { StoredVisit } from "./mock-medical-state";
import type { MockState } from "./mock-store";

// The API's medical guards for the mock (P2 spec §2, §5), in CLAUDE.md §6 order: active user →
// clinic access → module → key → scope. Hiding a button is UX; these refuse as well.

export type MedicalAccess = Actor & {
  actorName: string;
  keys: readonly string[];
  /** Branches of the member's own active scope (the `branch` scope of `view:visits`). */
  branches: { allBranches: boolean; branchIds: string[] };
};

export function parse<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError("validation");
  return parsed.data;
}

/** Active user, clinic access, the `medical` module. No key checked yet. */
export function guardMedical(db: MockState, persona: Persona): MedicalAccess {
  const actor = resolveActor(db, persona);
  if (clinicBlockReason(actor.clinic)) throw new ApiError("subscription_blocked");
  if (!(db.features[actor.clinic.id] ?? NO_FEATURES).medical) throw new ApiError("module_disabled");
  return {
    ...actor,
    actorName: actor.member.fullName,
    keys: effectivePermissions(db, actor),
    branches: memberBranchScope(db, actor.member),
  };
}

/** The guard plus one key in any of the listed scopes, else forbidden. */
export function requireKey(
  db: MockState,
  persona: Persona,
  action: "view" | "create" | "update",
  resource: "visits" | "medical" | "medicines",
  scopes: readonly ("clinic" | "branch" | "own")[],
): MedicalAccess {
  const a = guardMedical(db, persona);
  if (!scopes.some((s) => a.keys.includes(`${action}:${resource}:${s}`))) {
    throw new ApiError("forbidden");
  }
  return a;
}

/**
 * `own` on visits and medical: a file with an appointment with the caller that is not cancelled, or
 * any visit whose provider is the caller (spec §2, one predicate for both).
 */
export function isOwnMedicalPatient(db: MockState, a: MedicalAccess, patientId: string): boolean {
  return (
    isOwnPatient(db, a.clinic.id, a.member.id, patientId) ||
    db.medical.visits.some(
      (v) =>
        v.clinicId === a.clinic.id &&
        v.patientId === patientId &&
        v.providerMembershipId === a.member.id,
    )
  );
}

/** Does `view:visits:*` reach this visit: clinic, the member's branches, or an own file. */
export function seesVisit(db: MockState, a: MedicalAccess, v: StoredVisit): boolean {
  if (a.keys.includes("view:visits:clinic")) return true;
  if (
    a.keys.includes("view:visits:branch") &&
    (a.branches.allBranches || a.branches.branchIds.includes(v.branchId))
  ) {
    return true;
  }
  return a.keys.includes("view:visits:own") && isOwnMedicalPatient(db, a, v.patientId);
}

/** Does `view|update:medical:*` reach this file's clinical content. */
export function reachesContent(
  db: MockState,
  a: MedicalAccess,
  action: "view" | "update",
  patientId: string,
): boolean {
  if (a.keys.includes(`${action}:medical:clinic`)) return true;
  return a.keys.includes(`${action}:medical:own`) && isOwnMedicalPatient(db, a, patientId);
}

/** A patient file of the caller's clinic (else not_found). */
export function patientOf(db: MockState, a: MedicalAccess, patientId: string) {
  const patient = db.patients.find((p) => p.clinicId === a.clinic.id && p.id === patientId);
  if (!patient) throw new ApiError("not_found");
  return patient;
}

/** A visit the caller's visits view reaches; anything else is not_found (it cannot be probed). */
export function visibleVisit(db: MockState, a: MedicalAccess, visitId: string): StoredVisit {
  const v = db.medical.visits.find((x) => x.clinicId === a.clinic.id && x.id === visitId);
  if (!v || !seesVisit(db, a, v)) throw new ApiError("not_found");
  return v;
}

/**
 * A clinical write on a visit (note, diagnoses, prescription, sign, cancel, addendum), in the API's
 * `lockVisitForWrite` order after the update key (`medicalWriter`): a visit its update reach covers (else not_found), the
 * visit's provider only (P2-3), then its status. No view key is asked: a writer without one gets its
 * answer with `content: null`, as from the API (Codex PR #68).
 */
export function writableVisit(
  db: MockState,
  a: MedicalAccess,
  visitId: string,
  needs: "draft" | "signed",
): StoredVisit {
  const v = db.medical.visits.find((x) => x.clinicId === a.clinic.id && x.id === visitId);
  if (!v || !reachesContent(db, a, "update", v.patientId)) throw new ApiError("not_found");
  if (v.providerMembershipId !== a.member.id) throw new ApiError("visit_not_provider");
  // A cancelled draft is kept as it is: no transition leaves it (P2-6).
  if (v.status === "cancelled") throw new ApiError("invalid_transition");
  if (needs === "draft" && v.status === "signed") throw new ApiError("visit_signed");
  if (needs === "signed" && v.status !== "signed") throw new ApiError("visit_not_signed");
  return v;
}

/** The guard of every clinical write: an `update:medical` key, checked before the body is read. */
export const medicalWriter = (db: MockState, persona: Persona) =>
  requireKey(db, persona, "update", "medical", ["clinic", "own"]);

/**
 * The medical file's reach for the action alone, as the API's use cases (`reachable`, `patientInReach`):
 * a write needs only the update reach, a read only the view reach, and a file outside it is not_found
 * (cannot be probed).
 */
export function contentFile(
  db: MockState,
  a: MedicalAccess,
  action: "view" | "update",
  patientId: string,
) {
  const patient = patientOf(db, a, patientId);
  if (!reachesContent(db, a, action, patientId)) throw new ApiError("not_found");
  return patient;
}
