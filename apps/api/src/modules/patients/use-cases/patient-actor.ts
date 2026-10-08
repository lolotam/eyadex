import type { PatientDetail, PatientWriteResult } from "@eyadex/contracts/patients";
import { DatabaseError, type Tx } from "@eyadex/db";

import { ApiError } from "../../../shared/errors.ts";
import {
  coversBranch,
  type PatientRecord,
  type PatientScope,
  type PatientScopes,
} from "../domain/patient-rules.ts";
import { lockClinicPatients } from "../persistence/pg-patient-store.ts";
import { readPatientDetail } from "../queries/patient-views.ts";

/** الفاعل: عضو العيادة اللي الـ guard حلّه، بنطاقات أفعاله على المراجعين ومنطقة عيادته. */
export interface PatientActor {
  readonly clinicId: string;
  readonly userId: string;
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
function resultOf(actor: PatientActor, detail: PatientDetail): PatientWriteResult {
  const visible = coversBranch(actor.scopes.view, detail.registrationBranchId);
  return { id: detail.id, fileNumber: detail.fileNumber, detail: visible ? detail : null };
}

/**
 * A write's answer, read once after the write inside its transaction (the clinic's patients lock is
 * held, so no other patient write can commit in between).
 */
export async function writeResult(
  tx: Tx,
  actor: PatientActor,
  record: PatientRecord,
): Promise<PatientWriteResult> {
  const detail = await readPatientDetail(tx, actor.clinicId, record.id, actor.scopes);
  if (detail === null) throw new ApiError("not_found");
  return resultOf(actor, detail);
}

/**
 * The answer to a replayed create. The clinic's patients lock is taken FIRST, then the file is read
 * once: the create scope and the view scope are both judged on that same row, which no patient write
 * can change before this transaction ends. Outside the create scope it is `not_found`, like `open`.
 */
export async function replayResult(
  tx: Tx,
  actor: PatientActor,
  createScope: PatientScope,
  patientId: string,
): Promise<PatientWriteResult> {
  await lockClinicPatients(tx, actor.clinicId);
  const detail = await readPatientDetail(tx, actor.clinicId, patientId, actor.scopes);
  if (detail === null || !coversBranch(createScope, detail.registrationBranchId)) {
    throw new ApiError("not_found");
  }
  return resultOf(actor, detail);
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
