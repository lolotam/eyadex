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
  findCivilIdOwner,
  findPatient,
  findPhoneOwner,
  insertPatient,
  lockClinicPatients,
  nextFileNumber,
  setPatientStatus,
  updatePatientFields,
} from "../../persistence/pg-patient-store.ts";
import type { CivilIdCodec } from "../../persistence/civil-id-codec.ts";
import type { PatientBranchReader } from "../../ports/patient-branch-reader.ts";
import type { PatientReads } from "../../queries/patient-views.ts";
import {
  replayResult,
  requireScope,
  uniqueViolationAsValidation,
  writeResult,
  type PatientActor,
} from "../patient-actor.ts";

export interface PatientChangesDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Tenancy's branches behind the patients port (apps/api/AGENTS.md: no direct cross-module read). */
  readonly branches: PatientBranchReader;
  /** The civil ID's encrypted columns and blind index (ADR-0028). */
  readonly civilIds: CivilIdCodec;
}

/** What an idempotency key keeps: ids only, never the file (it carries the civil ID). */
interface StoredCreate {
  readonly id: string;
  readonly fileNumber: number;
}

/** The registration branch: unknown → not_found, outside the action's scope → forbidden, inactive. */
async function assertFilingBranch(
  reads: PatientReads,
  actor: PatientActor,
  scope: PatientScope,
  branchId: string,
): Promise<void> {
  const branch = await reads.branches.lockForFiling(reads.tx, actor.clinicId, branchId);
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

/**
 * One phone per clinic and one civil ID per clinic (PAT-02, 0021; the civil ID by its blind index or a
 * legacy plain number, R1-5), read under the clinic lock.
 */
async function assertUnique(
  tx: Tx,
  civilIds: CivilIdCodec,
  actor: PatientActor,
  input: NormalizedPatient,
  exceptId: string | null,
): Promise<void> {
  const phone = await findPhoneOwner(tx, actor.clinicId, input.phone, exceptId);
  assertNotDuplicate(actor, phone, "patient_phone_taken");
  if (input.civilId === null) return;
  const civil = await findCivilIdOwner(tx, civilIds, actor.clinicId, input.civilId, exceptId);
  assertNotDuplicate(actor, civil, "patient_civil_id_taken");
}

/**
 * تسجيل وتعديل وأرشفة واسترجاع ملفات المراجعين (stories P3–P5، ADR-0018). كل عملية transaction واحدة
 * جوه `withTenant` تحت قفل مراجعين العيادة، فيها صف سجل `patient_access` واحد. الملف برة نطاق الفعل =
 * `not_found`. مفيش حذف نهائي أبدًا.
 */
export class PatientChanges {
  constructor(private readonly deps: PatientChangesDeps) {}

  private reads(tx: Tx): PatientReads {
    return { tx, branches: this.deps.branches, civilIds: this.deps.civilIds };
  }

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
        // The replay needs the create scope over the file NOW (it may have changed since).
        if (claimed.kind === "replay")
          return replayResult(this.reads(tx), actor, scope, claimed.response.id);
        await lockClinicPatients(tx, actor.clinicId);
        await assertFilingBranch(this.reads(tx), actor, scope, normalized.registrationBranchId);
        await assertUnique(tx, this.deps.civilIds, actor, normalized, null);
        const now = clock.now();
        const record: PatientRecord = {
          ...normalized,
          id: ids.newId(),
          fileNumber: await nextFileNumber(tx, actor.clinicId, now),
          status: "active",
        };
        await insertPatient(tx, this.deps.civilIds, actor.clinicId, record, now);
        await this.audit(tx, actor, "patient.created", null, record);
        await completeClinicIdempotencyKey(tx, claim, {
          id: record.id,
          fileNumber: record.fileNumber,
        } satisfies StoredCreate);
        return writeResult(this.reads(tx), actor, record);
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
        const before = await findPatient(tx, this.deps.civilIds, actor.clinicId, id, true);
        if (before === null || !coversBranch(scope, before.registrationBranchId)) {
          throw new ApiError("not_found");
        }
        if (normalized.registrationBranchId !== before.registrationBranchId) {
          await assertFilingBranch(this.reads(tx), actor, scope, normalized.registrationBranchId);
        }
        await assertUnique(tx, this.deps.civilIds, actor, normalized, before.id);
        const after: PatientRecord = { ...before, ...normalized };
        await updatePatientFields(tx, this.deps.civilIds, actor.clinicId, after, clock.now());
        await this.audit(tx, actor, "patient.updated", before, after);
        return writeResult(this.reads(tx), actor, after);
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
      const before = await findPatient(tx, this.deps.civilIds, actor.clinicId, id, true);
      if (before === null || !coversBranch(scope, before.registrationBranchId)) {
        throw new ApiError("not_found");
      }
      if (before.status === status) return writeResult(this.reads(tx), actor, before);
      const after: PatientRecord = { ...before, status };
      await setPatientStatus(tx, actor.clinicId, after, clock.now());
      const action = status === "archived" ? "patient.archived" : "patient.restored";
      await this.audit(tx, actor, action, before, after);
      return writeResult(this.reads(tx), actor, after);
    });
  }
}
