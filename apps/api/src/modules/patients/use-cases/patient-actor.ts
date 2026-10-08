import type { PatientWriteResult } from "@eyadex/contracts/patients";
import { DatabaseError, type Tx } from "@eyadex/db";

import { ApiError } from "../../../shared/errors.ts";
import {
  coversBranch,
  type PatientRecord,
  type PatientScope,
  type PatientScopes,
} from "../domain/patient-rules.ts";
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

/** A write's answer: the full file only while the caller's VIEW scope covers its branch now. */
export async function writeResult(
  tx: Tx,
  actor: PatientActor,
  record: PatientRecord,
): Promise<PatientWriteResult> {
  const visible = coversBranch(actor.scopes.view, record.registrationBranchId);
  const detail = visible
    ? await readPatientDetail(tx, actor.clinicId, record.id, actor.scopes)
    : null;
  return { id: record.id, fileNumber: record.fileNumber, detail };
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
