import type { PatientInput, PatientWriteResult } from "@eyadex/contracts/patients";
import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import {
  claimClinicIdempotencyKey,
  completeClinicIdempotencyKey,
} from "../../../../shared/clinic-idempotency.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { requestHash } from "../../../../shared/idempotency.ts";
import { writePatientAccessAudit } from "../../../../shared/patient-audit.ts";
import type { Clock } from "../../../tenancy/index.ts";
import {
  coversBranch,
  duplicateDisclosure,
  isBirthDateAllowed,
  normalizePatientInput,
  patientAuditSnapshot,
  type DuplicateFile,
  type NormalizedPatient,
  type PatientRecord,
  type PatientScope,
} from "../../domain/patient-rules.ts";
import {
  findBranchForFiling,
  findCivilIdOwner,
  findPatient,
  findPhoneOwner,
  insertPatient,
  lockClinicPatients,
  nextFileNumber,
  setPatientStatus,
  updatePatientFields,
} from "../../persistence/pg-patient-store.ts";
import {
  requireScope,
  uniqueViolationAsValidation,
  writeResult,
  type PatientActor,
} from "../patient-actor.ts";

export interface PatientChangesDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** What an idempotency key keeps: ids only, never the file (it carries the civil ID). */
interface StoredCreate {
  readonly id: string;
  readonly fileNumber: number;
}

/** The registration branch: unknown → not_found, outside the action's scope → forbidden, inactive. */
async function assertFilingBranch(
  tx: Tx,
  actor: PatientActor,
  scope: PatientScope,
  branchId: string,
): Promise<void> {
  const branch = await findBranchForFiling(tx, actor.clinicId, branchId);
  if (branch === null) throw new ApiError("not_found");
  if (!coversBranch(scope, branchId)) throw new ApiError("forbidden");
  if (!branch.isActive) throw new ApiError("branch_inactive");
}

function assertNotDuplicate(
  actor: PatientActor,
  existing: DuplicateFile | null,
  code: "patient_phone_taken" | "patient_civil_id_taken",
): void {
  if (existing === null) return;
  const decision = duplicateDisclosure(existing, actor.scopes.view);
  if (decision.kind === "hidden") throw new ApiError("validation");
  throw new ApiError(code, { patientId: decision.patientId, fileNumber: decision.fileNumber });
}

/** One phone per clinic and one civil ID per clinic (PAT-02, 0021), read under the clinic lock. */
async function assertUnique(
  tx: Tx,
  actor: PatientActor,
  input: NormalizedPatient,
  exceptId: string | null,
): Promise<void> {
  const phone = await findPhoneOwner(tx, actor.clinicId, input.phone, exceptId);
  assertNotDuplicate(actor, phone, "patient_phone_taken");
  if (input.civilId === null) return;
  const civil = await findCivilIdOwner(tx, actor.clinicId, input.civilId, exceptId);
  assertNotDuplicate(actor, civil, "patient_civil_id_taken");
}

/**
 * تسجيل وتعديل وأرشفة واسترجاع ملفات المراجعين (stories P3–P5، ADR-0018). كل عملية transaction واحدة
 * جوه `withTenant` تحت قفل مراجعين العيادة، فيها صف سجل `patient_access` واحد. الملف برة نطاق الفعل =
 * `not_found`. مفيش حذف نهائي أبدًا.
 */
export class PatientChanges {
  constructor(private readonly deps: PatientChangesDeps) {}

  private normalized(actor: PatientActor, input: PatientInput): NormalizedPatient {
    const normalized = normalizePatientInput(input);
    if (normalized === null) throw new ApiError("validation");
    if (!isBirthDateAllowed(normalized.birthDate, actor.timezone, this.deps.clock.now())) {
      throw new ApiError("validation", [{ path: ["birthDate"], code: "custom" }]);
    }
    return normalized;
  }

  private async audit(
    tx: Tx,
    actor: PatientActor,
    action: string,
    before: PatientRecord | null,
    after: PatientRecord,
  ): Promise<void> {
    await writePatientAccessAudit(tx, {
      clinicId: actor.clinicId,
      id: this.deps.ids.newId(),
      actorUserId: actor.userId,
      action,
      patientId: after.id,
      branchId: after.registrationBranchId,
      details: {
        before: before === null ? null : patientAuditSnapshot(before),
        after: patientAuditSnapshot(after),
      },
      createdAt: this.deps.clock.now(),
    });
  }

  /**
   * بيسجّل ملف جديد بمفتاح `Idempotency-Key` إلزامي. رقم الملف العدّاد الجاي للعيادة (PAT-01). الإعادة
   * بنفس المفتاح والجسم بترجع نفس الملف (لو لسه جوه نطاق التسجيل)، وجسم مختلف = `idempotency_conflict`.
   *
   * @param actor الفاعل
   * @param input الجسم بعد `patientInputSchema`
   * @param idempotencyKey المفتاح
   * @returns الملف (التفاصيل بس لو الفاعل يقدر يفتحه)
   */
  async create(
    actor: PatientActor,
    input: PatientInput,
    idempotencyKey: string,
  ): Promise<PatientWriteResult> {
    const scope = requireScope(actor.scopes.create);
    const normalized = this.normalized(actor, input);
    const { db, clock, ids } = this.deps;
    const claim = {
      clinicId: actor.clinicId,
      scope: `patients:create:${actor.userId}`,
      key: idempotencyKey,
      // ADR-0018 §5: a plain digest is enough here; the ledger is RLS'd to the role that reads patients.
      hash: requestHash(normalized),
    };
    return db
      .withTenant(actor.clinicId, async (tx) => {
        const claimed = await claimClinicIdempotencyKey<StoredCreate>(
          tx,
          claim,
          ids.newId(),
          clock.now(),
        );
        if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
        if (claimed.kind === "replay") {
          // The replay needs the create scope over the file NOW (it may have changed since).
          const replayed = await findPatient(tx, actor.clinicId, claimed.response.id);
          if (replayed === null || !coversBranch(scope, replayed.registrationBranchId)) {
            throw new ApiError("not_found");
          }
          return writeResult(tx, actor, replayed);
        }
        await lockClinicPatients(tx, actor.clinicId);
        await assertFilingBranch(tx, actor, scope, normalized.registrationBranchId);
        await assertUnique(tx, actor, normalized, null);
        const now = clock.now();
        const record: PatientRecord = {
          ...normalized,
          id: ids.newId(),
          fileNumber: await nextFileNumber(tx, actor.clinicId, now),
          status: "active",
        };
        await insertPatient(tx, actor.clinicId, record.id, record.fileNumber, normalized, now);
        await this.audit(tx, actor, "patient.created", null, record);
        await completeClinicIdempotencyKey(tx, claim, {
          id: record.id,
          fileNumber: record.fileNumber,
        } satisfies StoredCreate);
        return writeResult(tx, actor, record);
      })
      .catch(uniqueViolationAsValidation);
  }

  /**
   * بيعدّل ملف جوه نطاق التعديل؛ نقله لفرع تاني محتاج الفرع الجديد يكون جوه نفس النطاق ونشط.
   *
   * @param actor الفاعل
   * @param id الملف
   * @param input الجسم بعد `patientInputSchema`
   * @returns الملف بعد التعديل
   */
  async update(actor: PatientActor, id: string, input: PatientInput): Promise<PatientWriteResult> {
    const scope = requireScope(actor.scopes.update);
    const normalized = this.normalized(actor, input);
    const { db, clock } = this.deps;
    return db
      .withTenant(actor.clinicId, async (tx) => {
        await lockClinicPatients(tx, actor.clinicId);
        const before = await findPatient(tx, actor.clinicId, id, true);
        if (before === null || !coversBranch(scope, before.registrationBranchId)) {
          throw new ApiError("not_found");
        }
        if (normalized.registrationBranchId !== before.registrationBranchId) {
          await assertFilingBranch(tx, actor, scope, normalized.registrationBranchId);
        }
        await assertUnique(tx, actor, normalized, before.id);
        await updatePatientFields(tx, actor.clinicId, before.id, normalized, clock.now());
        const after: PatientRecord = { ...before, ...normalized };
        await this.audit(tx, actor, "patient.updated", before, after);
        return writeResult(tx, actor, after);
      })
      .catch(uniqueViolationAsValidation);
  }

  /**
   * أرشفة أو استرجاع ملف جوه نطاق الأرشفة. نفس الحالة = نفس الرد من غير صف سجل.
   *
   * @param actor الفاعل
   * @param id الملف
   * @param status الحالة المطلوبة
   * @returns الملف بعد التغيير
   */
  setStatus(
    actor: PatientActor,
    id: string,
    status: PatientRecord["status"],
  ): Promise<PatientWriteResult> {
    const scope = requireScope(actor.scopes.deactivate);
    const { db, clock } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      await lockClinicPatients(tx, actor.clinicId);
      const before = await findPatient(tx, actor.clinicId, id, true);
      if (before === null || !coversBranch(scope, before.registrationBranchId)) {
        throw new ApiError("not_found");
      }
      if (before.status === status) return writeResult(tx, actor, before);
      await setPatientStatus(tx, actor.clinicId, before.id, status, clock.now());
      const after: PatientRecord = { ...before, status };
      const action = status === "archived" ? "patient.archived" : "patient.restored";
      await this.audit(tx, actor, action, before, after);
      return writeResult(tx, actor, after);
    });
  }
}
