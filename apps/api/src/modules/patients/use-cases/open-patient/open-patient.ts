import type { PatientDetail } from "@eyadex/contracts/patients";
import type { Database } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { ApiError } from "../../../../shared/errors.ts";
import { writePatientAccessAudit } from "../../../../shared/patient-audit.ts";
import type { Clock } from "../../../tenancy/index.ts";
import type { CivilIdCodec } from "../../persistence/civil-id-codec.ts";
import type { PatientBranchReader } from "../../ports/patient-branch-reader.ts";
import { viewSees } from "../../queries/own-patients.ts";
import { readPatientDetail } from "../../queries/patient-views.ts";
import { requireScope, type PatientActor } from "../patient-actor.ts";

export interface OpenPatientDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Tenancy's branches behind the patients port. */
  readonly branches: PatientBranchReader;
  /** The civil ID's encrypted columns (ADR-0028). */
  readonly civilIds: CivilIdCodec;
}

/**
 * فتح ملف مراجع (story P2، PRD §4.11): كل فتح بيكتب صف `patient.opened` واحد في نفس الـ transaction
 * اللي قرا الملف، فمفيش ملف بيتعرض من غير سجل. السجل فيه الـ id ورقم الملف بس.
 */
export class OpenPatient {
  constructor(private readonly deps: OpenPatientDeps) {}

  /**
   * بيفتح الملف لو فرعه جوه نطاق العرض، أو تحت `own` لو ليه موعد مش ملغي مع الفاعل (A3)؛ غير كده
   * `not_found` (مايتعرفش إنه موجود).
   *
   * @param actor الفاعل
   * @param id الملف
   * @returns الملف كامل
   */
  open(actor: PatientActor, id: string): Promise<PatientDetail> {
    const scope = requireScope(actor.scopes.view);
    const { db, clock, ids, branches, civilIds } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      const detail = await readPatientDetail({ tx, branches, civilIds }, actor, id);
      if (detail === null || !(await viewSees(tx, actor.clinicId, scope, detail))) {
        throw new ApiError("not_found");
      }
      await writePatientAccessAudit(tx, {
        clinicId: actor.clinicId,
        id: ids.newId(),
        actorUserId: actor.userId,
        action: "patient.opened",
        patientId: detail.id,
        branchId: detail.registrationBranchId,
        details: { before: null, after: { id: detail.id, fileNumber: detail.fileNumber } },
        createdAt: clock.now(),
      });
      return detail;
    });
  }
}
