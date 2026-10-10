import type { PatientDetail, PatientWriteResult } from "@eyadex/contracts/patients";
import { DatabaseError } from "@eyadex/db";

import { ApiError } from "../../../shared/errors.ts";
import {
  coversBranch,
  type MemberBranches,
  type PatientRecord,
  type PatientScope,
  type PatientScopes,
} from "../domain/patient-rules.ts";
import { lockClinicPatients } from "../persistence/pg-patient-store.ts";
import { viewSees } from "../queries/own-patients.ts";
import { readPatientDetail, type PatientReads } from "../queries/patient-views.ts";

/** الفاعل: عضو العيادة اللي الـ guard حلّه، بنطاقات أفعاله على المراجعين ومنطقة عيادته. */
export interface PatientActor {
  readonly clinicId: string;
  readonly userId: string;
  /** عضويته: نطاق `own` بيتحسب بيها (A3). */
  readonly membershipId: string;
  /** فروع عضويته النشطة، زي ما الـ guard حلّها. */
  readonly branches: MemberBranches;
  /** منطقة العيادة الزمنية: "النهارده" لتاريخ الميلاد. */
  readonly timezone: string;
  readonly scopes: PatientScopes;
}

/**
 * The scope of the route's own action. The guard already refused a caller without the key; this is
 * the second, independent check (default deny) the use case relies on.
 */
export function requireScope(scope: PatientScope | null): PatientScope {
  if (scope === null) throw new ApiError("forbidden");
  return scope;
}

// The full file goes out only when the caller's VIEW scope covers the branch of the very row that is
// returned, never of an earlier read of it: a file moved in between must not leak (Codex P1, slice 9).
// Under `own` it goes out only when the file is the caller's, judged in the same transaction (A3): a
// file just created has no appointment yet, so an own-only viewer gets `detail: null` for it.
async function resultOf(
  reads: PatientReads,
  actor: PatientActor,
  detail: PatientDetail,
): Promise<PatientWriteResult> {
  const visible = await viewSees(reads.tx, actor.clinicId, actor.scopes.view, detail);
  return { id: detail.id, fileNumber: detail.fileNumber, detail: visible ? detail : null };
}

/**
 * A write's answer, read once after the write inside its transaction (the clinic's patients lock is
 * held, so no other patient write can commit in between).
 */
export async function writeResult(
  reads: PatientReads,
  actor: PatientActor,
  record: PatientRecord,
): Promise<PatientWriteResult> {
  const detail = await readPatientDetail(reads, actor, record.id);
  if (detail === null) throw new ApiError("not_found");
  return resultOf(reads, actor, detail);
}

/**
 * The answer to a replayed create. The clinic's patients lock is taken FIRST, then the file is read
 * once: the create scope and the view scope are both judged on that same row, which no patient write
 * can change before this transaction ends. Outside the create scope it is `not_found`, like `open`.
 */
export async function replayResult(
  reads: PatientReads,
  actor: PatientActor,
  createScope: PatientScope,
  patientId: string,
): Promise<PatientWriteResult> {
  await lockClinicPatients(reads.tx, actor.clinicId);
  const detail = await readPatientDetail(reads, actor, patientId);
  if (detail === null || !coversBranch(createScope, detail.registrationBranchId)) {
    throw new ApiError("not_found");
  }
  return resultOf(reads, actor, detail);
}

/**
 * A unique violation that slipped past the checks under the clinic lock (it should not) is answered as a
 * plain validation error: never a 500, whose log line would carry the constraint name, and never a
 * disclosure of the other file.
 */
export function uniqueViolationAsValidation(error: unknown): never {
  if (error instanceof DatabaseError && error.code === "23505") throw new ApiError("validation");
  throw error;
}
