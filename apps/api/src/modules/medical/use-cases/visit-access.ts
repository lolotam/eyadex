import type { Tx } from "@eyadex/db";

import { ApiError } from "../../../shared/errors.ts";
import { lockProvider } from "../../../shared/provider-lock.ts";
import {
  medicalReach,
  medicalReachCovers,
  visitReachSees,
  visitViewReach,
  visitWriteProblem,
  type MedicalActor,
  type VisitWrite,
} from "../domain/visit-rules.ts";
import { findVisit, type VisitRow } from "../persistence/pg-visit-store.ts";
import { visitDetail } from "../queries/visit-views.ts";
import type { MedicalDeps, ReadContext } from "./medical-deps.ts";
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

/** A visit the caller may see, and whether its patient is one of the caller's (`own`). */
export interface SeenVisit {
  readonly visit: VisitRow;
  readonly patientIsOwn: boolean;
}

/**
 * A visit inside the caller's visits reach (spec §2), else `not_found`: another clinic's id, a visit of
 * another branch, a patient who is not the caller's under `own` all answer the same.
 *
 * @returns the visit and the patient's `own`
 */
export async function seeVisit(
  ctx: ReadContext,
  actor: MedicalActor,
  visitId: string,
): Promise<SeenVisit> {
  const visit = await findVisit(ctx.tx, actor.clinicId, visitId);
  if (visit === null) throw new ApiError("not_found");
  const patientIsOwn = await ctx.patients.isOwn(
    ctx.tx,
    actor.clinicId,
    actor.membershipId,
    visit.patientId,
  );
  if (!visitReachSees(visitViewReach(actor), visit, patientIsOwn)) throw new ApiError("not_found");
  return { visit, patientIsOwn };
}

/**
 * A visit about to be written (P2-3, P2-6), locked in the order of ADR-0027: outside the caller's
 * `update:medical` reach it is `not_found`; another provider's is `visit_not_provider` before any lock (a
 * visit never changes provider); then the caller's provider lock, then the row `FOR UPDATE`, and only
 * then the status check, so a write racing a sign sees the signed row.
 *
 * @returns the visit row, locked
 */
export async function lockVisitForWrite(
  deps: MedicalDeps,
  tx: Tx,
  actor: MedicalActor,
  visitId: string,
  write: VisitWrite,
): Promise<VisitRow> {
  const reach = medicalReach(actor, "update");
  if (reach === null) throw new ApiError("forbidden");
  const seen = await findVisit(tx, actor.clinicId, visitId);
  if (seen === null) throw new ApiError("not_found");
  const own = await deps.patients.isOwn(tx, actor.clinicId, actor.membershipId, seen.patientId);
  if (!medicalReachCovers(reach, own)) throw new ApiError("not_found");
  if (seen.providerMembershipId !== actor.membershipId) throw new ApiError("visit_not_provider");
  await lockProvider(tx, actor.clinicId, actor.membershipId);
  const visit = await findVisit(tx, actor.clinicId, visitId, true);
  if (visit === null) throw new ApiError("not_found");
  const problem = visitWriteProblem(visit, actor.membershipId, write);
  if (problem !== null) throw new ApiError(problem);
  return visit;
}

/**
 * One visit write in one transaction: lock in order (`lockVisitForWrite`), run the change, answer the
 * page as it stands after it. The caller is the provider, so the patient is its own (R1-18).
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
    const visit = await lockVisitForWrite(deps, tx, actor, visitId, kind);
    await change(tx, visit);
    const after = await findVisit(tx, actor.clinicId, visitId);
    if (after === null) throw new ApiError("not_found");
    return { visit: await visitDetail(readContext(deps, tx), actor, after, true) };
  });
}
