import type { Branch } from "@contracts/organization";
import type { PermissionAction } from "@contracts/permissions";
import {
  isBirthDateValid,
  todayInTimeZone,
  type Patient,
  type PatientDetail,
  type PatientListItem,
} from "@contracts/patients";
import type { Persona } from "@contracts/session";
import { ApiError } from "../api-error";
import { clinicBlockReason, effectivePermissions, resolveActor, type Actor } from "./mock-actor";
import type { MockState } from "./mock-store";

/** Resolved access for one patients action: all branches, or an explicit branch set. */
export type PatientAccess = Actor & {
  actorName: string;
  allBranches: boolean;
  branchIds: readonly string[];
};

/**
 * Check order: active user -> clinic access -> patients module -> permission at its scope.
 * Clinic scope (or a branch-scoped account with "all branches") covers every branch.
 */
/** The action-independent guards: active user, clinic access, patients module. */
export function guardPatients(db: MockState, persona: Persona): Actor {
  const actor = resolveActor(db, persona);
  if (clinicBlockReason(actor.clinic)) throw new ApiError("subscription_blocked");
  if (!(db.features[actor.clinic.id] ?? { patients: false }).patients)
    throw new ApiError("module_disabled");
  return actor;
}

export function authorizePatients(
  db: MockState,
  persona: Persona,
  action: PermissionAction,
): PatientAccess {
  const actor = guardPatients(db, persona);
  const keys = effectivePermissions(db, actor);
  const base = { ...actor, actorName: actor.member.fullName };
  if (keys.includes(`${action}:patients:clinic`))
    return { ...base, allBranches: true, branchIds: [] };
  if (keys.includes(`${action}:patients:branch`))
    return {
      ...base,
      allBranches: actor.member.allBranches,
      branchIds: actor.member.branchIds,
    };
  throw new ApiError("forbidden");
}

/** Same as authorizePatients, but null instead of throwing (used to decide what an error may reveal). */
export function tryAuthorizePatients(
  db: MockState,
  persona: Persona,
  action: PermissionAction,
): PatientAccess | null {
  try {
    return authorizePatients(db, persona, action);
  } catch {
    return null;
  }
}

export function inScope(access: PatientAccess, branchId: string): boolean {
  return access.allBranches || access.branchIds.includes(branchId);
}

/** A patient outside the caller's branches is not_found, never forbidden, so it can't be probed. */
export function findPatientInScope(
  db: MockState,
  access: PatientAccess,
  patientId: string,
): Patient {
  const patient = db.patients.find((p) => p.clinicId === access.clinic.id && p.id === patientId);
  if (!patient || !inScope(access, patient.registrationBranchId)) throw new ApiError("not_found");
  return patient;
}

/** The registration branch must be an active branch of this clinic, inside the caller's scope. */
export function enforceRegistrationBranch(
  db: MockState,
  access: PatientAccess,
  branchId: string,
): Branch {
  const branch = db.branches.find((b) => b.clinicId === access.clinic.id && b.id === branchId);
  if (!branch) throw new ApiError("not_found");
  if (!inScope(access, branchId)) throw new ApiError("forbidden");
  if (!branch.isActive) throw new ApiError("branch_inactive");
  return branch;
}

/**
 * One phone per clinic. The error names the existing file only when the caller could open it
 * under their own view scope; otherwise it carries no details.
 */
export function enforcePhoneFree(
  db: MockState,
  persona: Persona,
  clinicId: string,
  phone: string,
  exceptId: string | null,
): void {
  const existing = db.patients.find(
    (p) => p.clinicId === clinicId && p.phone === phone && p.id !== exceptId,
  );
  if (!existing) return;
  const viewer = tryAuthorizePatients(db, persona, "view");
  const visible = viewer !== null && inScope(viewer, existing.registrationBranchId);
  throw new ApiError(
    "patient_phone_taken",
    undefined,
    visible ? { patientId: existing.id, fileNumber: existing.fileNumber } : {},
  );
}

/** Birth dates may not be after today in the clinic's own time zone. */
export function enforceBirthDate(access: PatientAccess, birthDate: string): void {
  if (!isBirthDateValid(birthDate, todayInTimeZone(access.clinic.timezone)))
    throw new ApiError("validation");
}

/** Audit snapshot: an explicit allowlist, so civilId can never reach before/after values. */
export function patientSnapshot(p: Patient) {
  return {
    id: p.id,
    fileNumber: p.fileNumber,
    fullName: p.fullName,
    phone: p.phone,
    birthDate: p.birthDate,
    gender: p.gender,
    registrationBranchId: p.registrationBranchId,
    status: p.status,
  };
}

function branchNames(db: MockState, branchId: string) {
  const branch = db.branches.find((b) => b.id === branchId);
  return { branchNameAr: branch?.nameAr ?? "—", branchNameEn: branch?.nameEn ?? "—" };
}

export function toListItem(db: MockState, p: Patient): PatientListItem {
  return {
    id: p.id,
    fileNumber: p.fileNumber,
    fullName: p.fullName,
    phone: p.phone,
    registrationBranchId: p.registrationBranchId,
    ...branchNames(db, p.registrationBranchId),
    civilIdLast4: p.civilId ? p.civilId.slice(-4) : null,
    status: p.status,
  };
}

export function toDetail(db: MockState, p: Patient): PatientDetail {
  const { clinicId: _clinicId, ...rest } = p;
  return { ...rest, ...branchNames(db, p.registrationBranchId) };
}

export function matchesSearch(p: Patient, term: string): boolean {
  if (!term) return true;
  const lower = term.toLocaleLowerCase();
  const digits = term.replace(/\D/g, "");
  if (p.fullName.toLocaleLowerCase().includes(lower)) return true;
  if (!digits) return false;
  return (
    p.phone.replace(/\D/g, "").includes(digits) ||
    String(p.fileNumber).padStart(6, "0").includes(digits) ||
    (p.civilId ?? "").includes(digits)
  );
}
