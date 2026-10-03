import type { Branch } from "@eyadex/contracts/organization";
import type { PermissionAction } from "@eyadex/contracts/permissions";
import {
  isBirthDateValid,
  todayInTimeZone,
  type Patient,
  type PatientDetail,
  type PatientListItem,
  type PatientRecordActions,
  type PatientWriteResult,
} from "@eyadex/contracts/patients";
import type { Persona } from "@eyadex/contracts/session";
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
 * One phone per clinic. Only a caller who could open the existing file learns it is a duplicate
 * (with a link to it); anyone else gets a plain validation error, so no hidden file is confirmed.
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
  if (!visible) throw new ApiError("validation");
  throw new ApiError("patient_phone_taken", undefined, {
    patientId: existing.id,
    fileNumber: existing.fileNumber,
  });
}

/**
 * One civil ID per clinic, archived files included, so a number is never reused by another
 * person. Disclosure follows the phone rule exactly: only a caller who could open the existing
 * file learns it is a duplicate; anyone else gets a plain validation error, so no hidden file is
 * confirmed. The ID itself is never echoed back.
 */
export function enforceCivilIdFree(
  db: MockState,
  persona: Persona,
  clinicId: string,
  civilId: string | null,
  exceptId: string | null,
): void {
  if (!civilId) return;
  const existing = db.patients.find(
    (p) => p.clinicId === clinicId && p.civilId === civilId && p.id !== exceptId,
  );
  if (!existing) return;
  const viewer = tryAuthorizePatients(db, persona, "view");
  const visible = viewer !== null && inScope(viewer, existing.registrationBranchId);
  if (!visible) throw new ApiError("validation");
  throw new ApiError("patient_civil_id_taken", undefined, {
    patientId: existing.id,
    fileNumber: existing.fileNumber,
  });
}

/** Birth dates may not be after today in the clinic's own time zone. */
export function enforceBirthDate(access: PatientAccess, birthDate: string): void {
  let today: string;
  try {
    today = todayInTimeZone(access.clinic.timezone);
  } catch {
    // A stored zone the runtime doesn't know must still fail inside the error envelope.
    throw new ApiError("validation");
  }
  if (!isBirthDateValid(birthDate, today)) throw new ApiError("validation");
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

/** Per-record actions: the action's permission AND this record's branch inside that action's scope. */
export function recordActions(db: MockState, persona: Persona, p: Patient): PatientRecordActions {
  const allowed = (action: PermissionAction) => {
    const access = tryAuthorizePatients(db, persona, action);
    return access !== null && inScope(access, p.registrationBranchId);
  };
  return { update: allowed("update"), deactivate: allowed("deactivate") };
}

export function toListItem(db: MockState, persona: Persona, p: Patient): PatientListItem {
  return {
    id: p.id,
    fileNumber: p.fileNumber,
    fullName: p.fullName,
    phone: p.phone,
    registrationBranchId: p.registrationBranchId,
    ...branchNames(db, p.registrationBranchId),
    civilIdLast4: p.civilId ? p.civilId.slice(-4) : null,
    status: p.status,
    actions: recordActions(db, persona, p),
  };
}

export function toDetail(db: MockState, persona: Persona, p: Patient): PatientDetail {
  const { clinicId: _clinicId, ...rest } = p;
  return {
    ...rest,
    ...branchNames(db, p.registrationBranchId),
    actions: recordActions(db, persona, p),
  };
}

/** A write's result: the full file only while the caller may open it under their view scope. */
export function writeResult(db: MockState, persona: Persona, p: Patient): PatientWriteResult {
  const viewer = tryAuthorizePatients(db, persona, "view");
  const visible = viewer !== null && inScope(viewer, p.registrationBranchId);
  return { id: p.id, fileNumber: p.fileNumber, detail: visible ? toDetail(db, persona, p) : null };
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
