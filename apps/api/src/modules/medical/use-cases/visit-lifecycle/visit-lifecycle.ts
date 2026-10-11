import type {
  VisitNoteInput,
  visitAddendumInputSchema,
  visitCancelSchema,
} from "@eyadex/contracts/visits";
import type { Tx } from "@eyadex/db";
import type { z } from "zod";

import { ApiError } from "../../../../shared/errors.ts";
import {
  EMPTY_NOTE,
  NOTE_SECTIONS,
  changedFields,
  isSignable,
  sectionValue,
  type MedicalActor,
  type NoteSection,
  type VisitWrite,
} from "../../domain/visit-rules.ts";
import {
  insertAddendum,
  insertNote,
  notesOf,
  NOTE_COLUMN,
  updateNote,
} from "../../persistence/pg-note-store.ts";
import { activeDiagnosisCount } from "../../persistence/pg-diagnosis-store.ts";
import { markCancelled, markSigned, type VisitRow } from "../../persistence/pg-visit-store.ts";
import { openNote } from "../../queries/visit-views.ts";
import type { VisitWriteResponse } from "../start-visit/start-visit.ts";
import { auditMedical, sealOrNull, type MedicalDeps } from "../medical-deps.ts";
import { auditUnchangedWrite, writeVisit } from "../visit-access.ts";

type VisitCancelInput = z.infer<typeof visitCancelSchema>;
type VisitAddendumInput = z.infer<typeof visitAddendumInputSchema>;

/**
 * كتابات الزيارة بعد بدايتها (P2-3، P2-6): حفظ الملاحظة، الاعتماد، إلغاء المسودة، والملحق على المعتمدة.
 * كل كتابة transaction واحدة: قفل مقدّم الخدمة ثم صف الزيارة `FOR UPDATE` ثم فحص الحالة (ADR-0027)، فحفظ
 * بيسابق اعتماد بيشوف الزيارة معتمدة ومابيكتبش حاجة. كل عمود `*_enc` بيتشفّر مربوط بصفه هو، والسجل فيه
 * أسماء الحقول بس.
 */
export class VisitLifecycle {
  constructor(private readonly deps: MedicalDeps) {}

  /**
   * يحفظ أقسام الملاحظة الأربعة (المسودة بس). نفس القيم = نفس الرد من غير كتابة ولا صف سجل.
   *
   * @param actor الفاعل (مقدّم خدمة الزيارة)
   * @param visitId الزيارة
   * @param input الأقسام بعد `visitNoteInputSchema`
   * @returns الزيارة بعد الحفظ
   */
  saveNote(
    actor: MedicalActor,
    visitId: string,
    input: VisitNoteInput,
  ): Promise<VisitWriteResponse> {
    return this.write(actor, visitId, "note", async (tx, visit) => {
      const { clinicId } = actor;
      const stored = (await notesOf(tx, clinicId, [visit.id])).get(visit.id);
      const before = openNote(this.deps.cipher, clinicId, stored);
      const after = Object.fromEntries(
        NOTE_SECTIONS.map((s) => [s, sectionValue(input[s])]),
      ) as Record<NoteSection, string | null>;
      const changed = changedFields(before, after);
      if (changed.length === 0) {
        await auditUnchangedWrite(tx, this.deps, actor, visit);
        return;
      }
      const noteId = stored?.id ?? this.deps.ids.newId();
      const sections = Object.fromEntries(
        NOTE_SECTIONS.map((s) => [
          s,
          sealOrNull(
            this.deps.cipher,
            clinicId,
            { table: "visit_notes", column: NOTE_COLUMN[s], rowId: noteId },
            after[s],
          ),
        ]),
      ) as Record<NoteSection, string | null>;
      const write = {
        note: { id: noteId, visitId: visit.id, sections },
        updatedBy: actor.membershipId,
        now: this.now(),
      };
      await (stored === undefined ? insertNote : updateNote)(tx, clinicId, write);
      await this.audit(tx, actor, visit, "visit.note_saved", changed);
    });
  }

  /**
   * يعتمد المسودة فتتقفل (P2-6). محتاجة قسم ملاحظة مش فاضي أو تشخيص (`visit_empty`).
   *
   * @param actor الفاعل (مقدّم خدمة الزيارة)
   * @param visitId الزيارة
   * @returns الزيارة المعتمدة
   */
  sign(actor: MedicalActor, visitId: string): Promise<VisitWriteResponse> {
    return this.write(actor, visitId, "sign", async (tx, visit) => {
      const stored = (await notesOf(tx, actor.clinicId, [visit.id])).get(visit.id);
      const diagnoses = await activeDiagnosisCount(tx, actor.clinicId, visit.id);
      // Empty sections are stored NULL (R1-8), so content is known without opening it.
      if (!isSignable(stored?.sections ?? EMPTY_NOTE, diagnoses)) throw new ApiError("visit_empty");
      await markSigned(tx, actor.clinicId, visit.id, actor.membershipId, this.now());
      await this.audit(tx, actor, visit, "visit.signed", ["status"]);
    });
  }

  /**
   * يلغي المسودة بسبب (وملاحظة مشفّرة اختيارية)؛ الزيارة بتفضل، عمرها ما تتمسح.
   *
   * @param actor الفاعل (مقدّم خدمة الزيارة)
   * @param visitId الزيارة
   * @param input السبب والملاحظة بعد `visitCancelSchema`
   * @returns الزيارة الملغية
   */
  cancel(
    actor: MedicalActor,
    visitId: string,
    input: VisitCancelInput,
  ): Promise<VisitWriteResponse> {
    return this.write(actor, visitId, "cancel", async (tx, visit) => {
      const note = sectionValue(input.note);
      const noteEnc = sealOrNull(
        this.deps.cipher,
        actor.clinicId,
        { table: "visits", column: "cancel_note_enc", rowId: visit.id },
        note,
      );
      await markCancelled(
        tx,
        actor.clinicId,
        visit.id,
        { reason: input.reason, noteEnc },
        this.now(),
      );
      const changed =
        note === null ? ["status", "cancelReason"] : ["status", "cancelReason", "cancelNote"];
      await this.audit(tx, actor, visit, "visit.cancelled", changed);
    });
  }

  /**
   * يضيف ملحق على زيارة معتمدة (P2-6): مين وإمتى وإيه، من غير تعديل الملاحظة.
   *
   * @param actor الفاعل (مقدّم خدمة الزيارة)
   * @param visitId الزيارة
   * @param input النص بعد `visitAddendumInputSchema`
   * @returns الزيارة بملاحقها
   */
  addAddendum(
    actor: MedicalActor,
    visitId: string,
    input: VisitAddendumInput,
  ): Promise<VisitWriteResponse> {
    return this.write(actor, visitId, "addendum", async (tx, visit) => {
      const id = this.deps.ids.newId();
      const bodyEnc = this.deps.cipher.seal(
        actor.clinicId,
        { table: "visit_addenda", column: "body_enc", rowId: id },
        input.body,
      );
      await insertAddendum(
        tx,
        actor.clinicId,
        { id, visitId: visit.id, bodyEnc },
        actor.membershipId,
        this.now(),
      );
      await auditMedical(tx, this.deps, actor, {
        action: "visit.addendum_added",
        entityType: "visit_addendum",
        entityId: id,
        branchId: visit.branchId,
        changed: ["body"],
      });
    });
  }

  private write(
    actor: MedicalActor,
    visitId: string,
    kind: VisitWrite,
    change: (tx: Tx, visit: VisitRow) => Promise<void>,
  ): Promise<VisitWriteResponse> {
    return writeVisit(this.deps, actor, visitId, kind, change);
  }

  private audit(tx: Tx, actor: MedicalActor, visit: VisitRow, action: string, changed: string[]) {
    return auditMedical(tx, this.deps, actor, {
      action,
      entityType: "visit",
      entityId: visit.id,
      branchId: visit.branchId,
      changed,
    });
  }

  private now(): Date {
    return this.deps.clock.now();
  }
}
