import type { Medicine, MedicineInput } from "@eyadex/contracts/medicines";
import { DatabaseError, type Tx } from "@eyadex/db";

import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import {
  claimClinicIdempotencyKey,
  completeClinicIdempotencyKey,
} from "../../../../shared/clinic-idempotency.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { requestHash } from "../../../../shared/idempotency.ts";
import { changedFields, sectionValue, type MedicalActor } from "../../domain/visit-rules.ts";
import {
  findMedicine,
  insertMedicine,
  lockClinicMedicines,
  medicineNameTaken,
  saveMedicine,
} from "../../persistence/pg-medicine-store.ts";
import type { MedicalDeps } from "../medical-deps.ts";

type Fields = Pick<Medicine, "name" | "defaultDose" | "defaultFrequency">;
type Decision = { next: Medicine; action: string; changed: string[] } | null;

// A blank default is no default.
const fieldsOf = (input: MedicineInput): Fields => ({
  name: input.name,
  defaultDose: sectionValue(input.defaultDose),
  defaultFrequency: sectionValue(input.defaultFrequency),
});

const NONE: Record<keyof Fields, null> = { name: null, defaultDose: null, defaultFrequency: null };

// The unique index backs the check under the lock; if it still fires it is the same answer.
function nameTakenOnUnique(error: unknown): never {
  if (error instanceof DatabaseError && error.code === "23505") {
    throw new ApiError("medicine_name_taken");
  }
  throw error;
}

/**
 * قايمة أدوية العيادة (P2-F2، R3-3): إنشاء بمفتاح `Idempotency-Key`، تعديل، تعطيل وإعادة تفعيل. كل
 * عملية transaction واحدة تحت قفل أدوية العيادة (قفل لوحده، مفيش صف تاني بيتقفل معاه)، فيها صف سجل
 * إداري واحد بأسماء الحقول بس (spec §5: لا اسم دوا ولا جرعة). مفيش حذف.
 */
export class MedicineChanges {
  constructor(private readonly deps: Pick<MedicalDeps, "db" | "clock" | "ids">) {}

  /**
   * دوا جديد نشط. نفس المفتاح ونفس الجسم = نفس الدوا؛ جسم مختلف = `idempotency_conflict`.
   *
   * @param actor الفاعل (شايل `update:medicines:clinic`)
   * @param input الدوا بعد `medicineInputSchema`
   * @param idempotencyKey المفتاح
   * @returns الدوا زي ما اتحفظ
   */
  create(actor: MedicalActor, input: MedicineInput, idempotencyKey: string): Promise<Medicine> {
    const { db, clock, ids } = this.deps;
    const fields = fieldsOf(input);
    const claim = {
      clinicId: actor.clinicId,
      scope: `medicine:create:${actor.userId}`,
      key: idempotencyKey,
      hash: requestHash(input),
    };
    return db
      .withTenant(actor.clinicId, async (tx) => {
        const claimed = await claimClinicIdempotencyKey<{ medicineId: string }>(
          tx,
          claim,
          ids.newId(),
          clock.now(),
        );
        if (claimed.kind === "conflict") throw new ApiError("idempotency_conflict");
        if (claimed.kind === "replay") return this.reload(tx, actor, claimed.response.medicineId);
        await lockClinicMedicines(tx, actor.clinicId);
        if (await medicineNameTaken(tx, actor.clinicId, fields.name, null)) {
          throw new ApiError("medicine_name_taken");
        }
        const medicine: Medicine = { id: ids.newId(), ...fields, status: "active" };
        await insertMedicine(tx, actor.clinicId, medicine, clock.now());
        await this.audit(tx, actor, "medicine.created", medicine.id, changedFields(NONE, fields));
        await completeClinicIdempotencyKey(tx, claim, { medicineId: medicine.id });
        return medicine;
      })
      .catch(nameTakenOnUnique);
  }

  /**
   * يعدّل الاسم والجرعة والتكرار الافتراضيين؛ نفس القيم = نفس الرد من غير صف سجل.
   *
   * @param actor الفاعل
   * @param id الدوا
   * @param input الدوا بعد `medicineInputSchema`
   * @returns الدوا بعد التعديل
   */
  update(actor: MedicalActor, id: string, input: MedicineInput): Promise<Medicine> {
    const fields = fieldsOf(input);
    return this.change(actor, id, async (tx, before) => {
      const changed = changedFields(before, fields);
      if (changed.length === 0) return null;
      if (await medicineNameTaken(tx, actor.clinicId, fields.name, id)) {
        throw new ApiError("medicine_name_taken");
      }
      return { next: { ...before, ...fields }, action: "medicine.updated", changed };
    }).catch(nameTakenOnUnique);
  }

  /**
   * تعطيل أو إعادة تفعيل؛ نفس الحالة = نفس الرد من غير صف سجل.
   *
   * @param actor الفاعل
   * @param id الدوا
   * @param status الحالة المطلوبة
   * @returns الدوا بعد التغيير
   */
  setStatus(actor: MedicalActor, id: string, status: Medicine["status"]): Promise<Medicine> {
    return this.change(actor, id, async (_tx, before) => {
      if (before.status === status) return null;
      const action = status === "inactive" ? "medicine.deactivated" : "medicine.reactivated";
      return { next: { ...before, status }, action, changed: ["status"] };
    });
  }

  private change(
    actor: MedicalActor,
    id: string,
    decide: (tx: Tx, before: Medicine) => Promise<Decision>,
  ): Promise<Medicine> {
    const { db, clock } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      await lockClinicMedicines(tx, actor.clinicId);
      const before = await findMedicine(tx, actor.clinicId, id);
      if (before === null) throw new ApiError("not_found");
      const decided = await decide(tx, before);
      if (decided === null) return before;
      await saveMedicine(tx, actor.clinicId, decided.next, clock.now());
      await this.audit(tx, actor, decided.action, id, decided.changed);
      return decided.next;
    });
  }

  // Administrative (the clinic's list, not patient data), never the platform's (0046's view and policy).
  private async audit(
    tx: Tx,
    actor: MedicalActor,
    action: string,
    medicineId: string,
    changed: readonly string[],
  ): Promise<void> {
    await writeClinicAudit(tx, {
      clinicId: actor.clinicId,
      id: this.deps.ids.newId(),
      actorUserId: actor.userId,
      action,
      entityType: "medicine",
      entityId: medicineId,
      details: { before: null, after: { changed: [...changed] } },
      createdAt: this.deps.clock.now(),
    });
  }

  private async reload(tx: Tx, actor: MedicalActor, id: string): Promise<Medicine> {
    const medicine = await findMedicine(tx, actor.clinicId, id);
    if (medicine === null) throw new ApiError("not_found");
    return medicine;
  }
}
