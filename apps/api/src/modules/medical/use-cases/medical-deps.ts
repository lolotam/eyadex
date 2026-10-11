import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { writeMedicalAccessAudit, type MedicalAuditEntity } from "../../../shared/medical-audit.ts";
import type { Clock } from "../../tenancy/index.ts";
import type { MedicalActor } from "../domain/visit-rules.ts";
import type { ClinicalCipher, FieldRef } from "../ports/clinical-cipher.ts";
import type { MedicalAppointmentReader } from "../ports/medical-appointment-reader.ts";
import type { MedicalBranchReader } from "../ports/medical-branch-reader.ts";
import type { MedicalClinicReader } from "../ports/medical-clinic-reader.ts";
import type { MedicalMemberDirectory } from "../ports/medical-member-directory.ts";
import type { MedicalPatientReader } from "../ports/medical-patient-reader.ts";

/** Everything the medical use cases share: the pool, time, ids, the cipher and the module's ports. */
export interface MedicalDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly cipher: ClinicalCipher;
  readonly patients: MedicalPatientReader;
  readonly appointments: MedicalAppointmentReader;
  readonly members: MedicalMemberDirectory;
  readonly branches: MedicalBranchReader;
  readonly clinics: MedicalClinicReader;
}

/** What a medical read needs inside its transaction. */
export type ReadContext = Pick<MedicalDeps, "cipher" | "patients" | "members" | "branches"> & {
  readonly tx: Tx;
};

/**
 * Seals a text, or stores `null` for an empty one (R1-8: an empty optional section is never sealed).
 *
 * @returns the envelope, or `null`
 */
export function sealOrNull(
  cipher: ClinicalCipher,
  clinicId: string,
  ref: FieldRef,
  plain: string | null,
): string | null {
  return plain === null ? null : cipher.seal(clinicId, ref, plain);
}

/**
 * Opens an envelope, or `null` for an empty column.
 *
 * @returns the text, or `null`
 */
export function openOrNull(
  cipher: ClinicalCipher,
  clinicId: string,
  ref: FieldRef,
  envelope: string | null,
): string | null {
  return envelope === null ? null : cipher.open(clinicId, ref, envelope);
}

/** One medical audit row: what happened, to what, in which branch. */
export interface MedicalAuditEvent {
  readonly action: string;
  readonly entityType: MedicalAuditEntity;
  readonly entityId: string | null;
  readonly branchId: string | null;
  /** The field NAMES a write changed (R3-4); reads record none. */
  readonly changed?: readonly string[];
}

/**
 * Writes one `patient_access` row in the use case's transaction. A write records `after.changed` (field
 * names, which the audit screen shows); a read records nothing but who, what and when.
 */
export async function auditMedical(
  tx: Tx,
  deps: Pick<MedicalDeps, "ids" | "clock">,
  actor: MedicalActor,
  event: MedicalAuditEvent,
): Promise<void> {
  await writeMedicalAccessAudit(tx, {
    clinicId: actor.clinicId,
    id: deps.ids.newId(),
    actorUserId: actor.userId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    branchId: event.branchId,
    details:
      event.changed === undefined
        ? { before: null, after: null }
        : { before: null, after: { changed: [...event.changed] } },
    createdAt: deps.clock.now(),
  });
}
