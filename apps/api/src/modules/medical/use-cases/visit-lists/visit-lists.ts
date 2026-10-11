import type {
  visitDiagnosesInputSchema,
  visitPrescriptionInputSchema,
} from "@eyadex/contracts/visits";
import type { Tx } from "@eyadex/db";
import type { z } from "zod";

import { ApiError } from "../../../../shared/errors.ts";
import {
  codesOf,
  diagnosisItem,
  hasUnknownCode,
  prescriptionItem,
  sameList,
  type DiagnosisItem,
  type PrescriptionItem,
} from "../../domain/visit-lists.ts";
import type { MedicalActor } from "../../domain/visit-rules.ts";
import {
  archiveDiagnoses,
  diagnosesOf,
  insertDiagnoses,
  type NewDiagnosis,
} from "../../persistence/pg-diagnosis-store.ts";
import { billableCodes } from "../../persistence/pg-icd10-store.ts";
import {
  archivePrescription,
  insertPrescription,
  prescriptionOf,
  type NewPrescriptionItem,
} from "../../persistence/pg-prescription-store.ts";
import type { VisitRow } from "../../persistence/pg-visit-store.ts";
import {
  asDiagnosisItem,
  asPrescriptionItem,
  openDiagnoses,
  openPrescription,
} from "../../queries/visit-lists-view.ts";
import type { VisitWriteResponse } from "../start-visit/start-visit.ts";
import { auditMedical, sealOrNull, type MedicalDeps } from "../medical-deps.ts";
import { auditUnchangedWrite, writeVisit } from "../visit-access.ts";

type DiagnosesInput = z.infer<typeof visitDiagnosesInputSchema>;
type PrescriptionInput = z.infer<typeof visitPrescriptionInputSchema>;

/**
 * التشخيصات والروشتة (P2-8، P2-9): كل قايمة بتتبدّل كلها على المسودة، من مقدّم خدمة الزيارة بس. التبديل
 * transaction واحدة تحت قفل الزيارة (ADR-0027): الصفوف النشطة بتتأرشف والقايمة الجديدة بتتكتب بمعرّفات
 * جديدة، كل ظرف مربوط بصفه (R1-13). نفس القايمة = مفيش كتابة ولا صف سجل؛ السجل فيه اسم الحقل بس.
 */
export class VisitLists {
  constructor(private readonly deps: MedicalDeps) {}

  /**
   * يبدّل تشخيصات المسودة. كود ICD-10 مش موجود أو مش صالح للتشخيص = `icd10_unknown` (R2-8).
   *
   * @param actor الفاعل (مقدّم خدمة الزيارة)
   * @param visitId الزيارة
   * @param input القايمة بعد `visitDiagnosesInputSchema`
   * @returns الزيارة بعد الحفظ
   */
  saveDiagnoses(
    actor: MedicalActor,
    visitId: string,
    input: DiagnosesInput,
  ): Promise<VisitWriteResponse> {
    const after = input.items.map(diagnosisItem);
    return writeVisit(this.deps, actor, visitId, "diagnoses", async (tx, visit) => {
      const { clinicId } = actor;
      if (hasUnknownCode(after, await billableCodes(tx, codesOf(after)))) {
        throw new ApiError("icd10_unknown");
      }
      const stored = await diagnosesOf(tx, clinicId, [visit.id]);
      const before = openDiagnoses(this.deps.cipher, clinicId, stored).map(asDiagnosisItem);
      if (sameList(before, after)) {
        await auditUnchangedWrite(tx, this.deps, actor, visit);
        return;
      }
      const rows = after.map((item, position) => this.sealDiagnosis(clinicId, item, position));
      await archiveDiagnoses(tx, clinicId, visit.id, this.deps.clock.now());
      await insertDiagnoses(tx, clinicId, visit.id, rows, this.deps.clock.now());
      await this.audit(tx, actor, visit, "diagnosis", "visit.diagnoses_saved");
    });
  }

  /**
   * يبدّل روشتة المسودة.
   *
   * @param actor الفاعل (مقدّم خدمة الزيارة)
   * @param visitId الزيارة
   * @param input القايمة بعد `visitPrescriptionInputSchema`
   * @returns الزيارة بعد الحفظ
   */
  savePrescription(
    actor: MedicalActor,
    visitId: string,
    input: PrescriptionInput,
  ): Promise<VisitWriteResponse> {
    const after = input.items.map(prescriptionItem);
    return writeVisit(this.deps, actor, visitId, "prescription", async (tx, visit) => {
      const { clinicId } = actor;
      const stored = await prescriptionOf(tx, clinicId, [visit.id]);
      const before = openPrescription(this.deps.cipher, clinicId, stored).map(asPrescriptionItem);
      if (sameList(before, after)) {
        await auditUnchangedWrite(tx, this.deps, actor, visit);
        return;
      }
      const rows = after.map((item, position) => this.sealItem(clinicId, item, position));
      await archivePrescription(tx, clinicId, visit.id, this.deps.clock.now());
      await insertPrescription(tx, clinicId, visit.id, rows, this.deps.clock.now());
      await this.audit(tx, actor, visit, "prescription", "visit.prescription_saved");
    });
  }

  // A new row gets a new id, and every envelope is bound to it (ADR-0028): a replaced row's envelopes
  // can never be opened as the new row's.
  private sealDiagnosis(clinicId: string, item: DiagnosisItem, position: number): NewDiagnosis {
    const id = this.deps.ids.newId();
    const ref = (column: string) => ({ table: "visit_diagnoses", column, rowId: id });
    return {
      id,
      position,
      kind: item.kind,
      codeEnc: sealOrNull(this.deps.cipher, clinicId, ref("code_enc"), item.code),
      textEnc: this.deps.cipher.seal(clinicId, ref("text_enc"), item.text),
    };
  }

  private sealItem(
    clinicId: string,
    item: PrescriptionItem,
    position: number,
  ): NewPrescriptionItem {
    const id = this.deps.ids.newId();
    const ref = (field: string) => ({
      table: "visit_prescription_items",
      column: `${field}_enc`,
      rowId: id,
    });
    const seal = (field: "medicine" | "dose" | "frequency" | "duration") =>
      this.deps.cipher.seal(clinicId, ref(field), item[field]);
    return {
      id,
      position,
      sealed: {
        medicine: seal("medicine"),
        dose: seal("dose"),
        frequency: seal("frequency"),
        duration: seal("duration"),
        note: sealOrNull(this.deps.cipher, clinicId, ref("note"), item.note),
      },
    };
  }

  // A replace changes the visit's whole list, so the row names the visit and the one field: the items.
  private audit(
    tx: Tx,
    actor: MedicalActor,
    visit: VisitRow,
    entityType: "diagnosis" | "prescription",
    action: string,
  ) {
    return auditMedical(tx, this.deps, actor, {
      action,
      entityType,
      entityId: visit.id,
      branchId: visit.branchId,
      changed: ["items"],
    });
  }
}
