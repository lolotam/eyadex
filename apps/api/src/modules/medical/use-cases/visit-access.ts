import type { Tx } from "@eyadex/db";

import { ApiError } from "../../../shared/errors.ts";
import { lockProvider } from "../../../shared/provider-lock.ts";
import {
  medicalReach,
  medicalReachCovers,
  visitReachSees,
  visitViewReach,
  visitWriteProblem,
  type FileAccess,
  type MedicalActor,
  type VisitWrite,
} from "../domain/visit-rules.ts";
import { findVisit, type VisitRow } from "../persistence/pg-visit-store.ts";
import type { MedicalPatient } from "../ports/medical-patient-reader.ts";
import { readsContent, visitDetail } from "../queries/visit-views.ts";
import { auditMedical, type MedicalDeps, type ReadContext } from "./medical-deps.ts";
import type { VisitWriteResponse } from "./start-visit/start-visit.ts";

/**
 * The read context of one medical transaction.
 *
 * @returns the transaction with the module's cipher and ports
 */
export const readContext = (deps: MedicalDeps, tx: Tx): ReadContext => ({
  tx,
  cipher: deps.cipher,
  patients: deps.patients,
  members: deps.members,
  branches: deps.branches,
});

/** A visit the caller may see, and the caller's relation to its patient's file. */
export interface SeenVisit {
  readonly visit: VisitRow;
  readonly file: FileAccess;
}

/**
 * The caller's relation to a patient file, by the patients module's own rules (the port): `own`, and
 * whether the patients view reach sees it (owner decision 2026-10-11).
 *
 * @returns the relation
 */
export const fileAccess = (
  patients: ReadContext["patients"],
  tx: Tx,
  actor: MedicalActor,
  patientId: string,
): Promise<FileAccess> => patients.access(tx, actor.clinicId, actor, patientId);

/**
 * A patient file the caller's medical reach for the action covers (`own` = one of its patients) and its
 * patients view reach sees (owner decision 2026-10-11), else `not_found`: another clinic's file, one that
 * is not the caller's and one outside its patients reach answer the same. `lock` takes the patient row
 * FOR SHARE (ADR-0027) for a write whose INSERT references it.
 *
 * @returns the file and the caller's relation to it
 */
export async function reachFile(
  patients: ReadContext["patients"],
  tx: Tx,
  actor: MedicalActor,
  action: "view" | "update",
  patientId: string,
  lock: boolean,
): Promise<{ patient: MedicalPatient; file: FileAccess }> {
  const reach = medicalReach(actor, action);
  if (reach === null) throw new ApiError("forbidden");
  const patient = lock
    ? await patients.lockForVisit(tx, actor.clinicId, patientId)
    : await patients.find(tx, actor.clinicId, patientId);
  if (patient === null) throw new ApiError("not_found");
  const file = await fileAccess(patients, tx, actor, patientId);
  if (!medicalReachCovers(reach, file)) throw new ApiError("not_found");
  return { patient, file };
}

/**
 * A visit inside the caller's visits reach (spec §2), else `not_found`: another clinic's id, a visit of
 * another branch, a patient who is not the caller's under `own` all answer the same.
 *
 * @returns the visit and the caller's relation to its patient
 */
export async function seeVisit(
  ctx: ReadContext,
  actor: MedicalActor,
  visitId: string,
): Promise<SeenVisit> {
  const visit = await findVisit(ctx.tx, actor.clinicId, visitId);
  if (visit === null) throw new ApiError("not_found");
  const file = await fileAccess(ctx.patients, ctx.tx, actor, visit.patientId);
  // The visits reach alone decides the visit (metadata); the content follows `file` (visitDetail).
  if (!visitReachSees(visitViewReach(actor), visit, file.own)) throw new ApiError("not_found");
  return { visit, file };
}

/**
 * A visit about to be written (P2-3, P2-6), locked in the order of ADR-0027: outside the caller's
 * `update:medical` reach, or outside its patients view reach, it is `not_found`; another provider's is `visit_not_provider` before any lock (a
 * visit never changes provider); then the caller's provider lock, then the row `FOR UPDATE`, and only
 * then the status check, so a write racing a sign sees the signed row.
 *
 * @returns the visit row, locked, and the caller's relation to its patient
 */
export async function lockVisitForWrite(
  deps: MedicalDeps,
  tx: Tx,
  actor: MedicalActor,
  visitId: string,
  write: VisitWrite,
): Promise<SeenVisit> {
  const reach = medicalReach(actor, "update");
  if (reach === null) throw new ApiError("forbidden");
  const seen = await findVisit(tx, actor.clinicId, visitId);
  if (seen === null) throw new ApiError("not_found");
  const file = await fileAccess(deps.patients, tx, actor, seen.patientId);
  if (!medicalReachCovers(reach, file)) throw new ApiError("not_found");
  if (seen.providerMembershipId !== actor.membershipId) throw new ApiError("visit_not_provider");
  await lockProvider(tx, actor.clinicId, actor.membershipId);
  const visit = await findVisit(tx, actor.clinicId, visitId, true);
  if (visit === null) throw new ApiError("not_found");
  const problem = visitWriteProblem(visit, actor.membershipId, write);
  if (problem !== null) throw new ApiError(problem);
  return { visit, file };
}

/**
 * A visit write whose payload equals what is stored writes nothing, but its answer still carries the
 * decrypted content, so it is audited as an open (`visit.opened`), the same trail as GET (Codex P2 PR
 * #68). An answer without the content (a provider with no `view:medical`, or a file outside its patients
 * view reach) opens nothing and logs nothing. The note, diagnoses and prescription
 * saves call it on their no-op path, and a start replayed with its `Idempotency-Key` on its answer.
 *
 * @returns once the row, if any, is written in the write's transaction
 */
export async function auditUnchangedWrite(
  tx: Tx,
  deps: MedicalDeps,
  actor: MedicalActor,
  visit: VisitRow,
): Promise<void> {
  const file = await fileAccess(deps.patients, tx, actor, visit.patientId);
  if (!readsContent(actor, file)) return;
  await auditMedical(tx, deps, actor, {
    action: "visit.opened",
    entityType: "visit",
    entityId: visit.id,
    branchId: visit.branchId,
  });
}

/**
 * One visit write in one transaction: lock in order (`lockVisitForWrite`), run the change, answer the
 * page as it stands after it.
 *
 * @returns the visit page after the change
 */
export function writeVisit(
  deps: MedicalDeps,
  actor: MedicalActor,
  visitId: string,
  kind: VisitWrite,
  change: (tx: Tx, visit: VisitRow) => Promise<void>,
): Promise<VisitWriteResponse> {
  return deps.db.withTenant(actor.clinicId, async (tx) => {
    const { visit, file } = await lockVisitForWrite(deps, tx, actor, visitId, kind);
    await change(tx, visit);
    const after = await findVisit(tx, actor.clinicId, visitId);
    if (after === null) throw new ApiError("not_found");
    return { visit: await visitDetail(readContext(deps, tx), actor, after, file) };
  });
}
