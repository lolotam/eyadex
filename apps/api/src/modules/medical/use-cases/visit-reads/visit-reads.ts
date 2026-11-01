import {
  patientNotificationListSchema,
  type PatientNotificationList,
} from "@eyadex/contracts/notifications";
import type {
  VisitDetail,
  VisitList,
  VisitSearchInput,
  WalkInCandidates,
  WalkInSearchInput,
} from "@eyadex/contracts/visits";
import type { z } from "zod";
import type { walkInBranchesSchema } from "@eyadex/contracts/visits";

import { parseContract } from "../../../../shared/contract-parser.ts";
import { ApiError } from "../../../../shared/errors.ts";
import {
  medicalReach,
  medicalReachCovers,
  visitViewReach,
  worksIn,
  type MedicalActor,
} from "../../domain/visit-rules.ts";
import type { MedicalPatient } from "../../ports/medical-patient-reader.ts";
import { listVisitPage, searchVisitPage } from "../../queries/visit-list.ts";
import { readsContent, visitDetail } from "../../queries/visit-views.ts";
import { auditMedical, type MedicalDeps, type ReadContext } from "../medical-deps.ts";
import { fileAccess, readContext, seeVisit } from "../visit-access.ts";

type WalkInBranches = z.infer<typeof walkInBranchesSchema>;

// Task 11: a walk-in for this file is possible (UX only; `start` checks again under its locks).
const canStart = (actor: MedicalActor, patient: MedicalPatient): boolean =>
  actor.permissions.includes("create:visits:own") &&
  patient.active &&
  worksIn(actor.member, patient.registrationBranchId);

/**
 * قراية الزيارات (spec §5): صفحة الزيارة، قايمة زيارات المراجع، البحث جوه ملاحظاته، واختيارات الزيارة
 * المباشرة. كل قراية لمحتوى طبي (فتح زيارة بمحتواها، معاينات القايمة، البحث، بحث الزيارة المباشرة) بتكتب
 * صف `patient_access` واحد في نفس الـ transaction، من غير أي نص ولا كلمة بحث (P2-K2، R3-4).
 */
export class VisitReads {
  constructor(private readonly deps: MedicalDeps) {}

  /**
   * صفحة الزيارة جوه وصول العرض، والمحتوى بس لقارئه (`visit.opened` لما المحتوى يطلع).
   *
   * @param actor الفاعل
   * @param visitId الزيارة
   * @returns الصفحة
   */
  open(actor: MedicalActor, visitId: string): Promise<VisitDetail> {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const ctx = readContext(this.deps, tx);
      const { visit, file } = await seeVisit(ctx, actor, visitId);
      const detail = await visitDetail(ctx, actor, visit, file);
      if (detail.content !== null) {
        await auditMedical(tx, this.deps, actor, {
          action: "visit.opened",
          entityType: "visit",
          entityId: visit.id,
          branchId: visit.branchId,
        });
      }
      return detail;
    });
  }

  /**
   * تاريخ رسائل الزيارة (رسالة الروشتة، ADR-0031) جوه وصول عرض الزيارات بس: حالة الرسالة بيانات وصفية من
   * غير محتوى طبي، فمابتكتبش صف وصول. زيارة برة الوصول أو من عيادة تانية = `not_found`.
   *
   * @param actor الفاعل
   * @param visitId الزيارة
   * @returns الرسائل، الأحدث الأول
   */
  notifications(actor: MedicalActor, visitId: string): Promise<PatientNotificationList> {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const { visit } = await seeVisit(readContext(this.deps, tx), actor, visitId);
      const history = await this.deps.notifications.history(tx, actor.clinicId, visit.id);
      return parseContract(patientNotificationListSchema, history);
    });
  }

  /**
   * زيارات المراجع الأحدث الأول جوه وصول العرض، بالمعاينة لقارئ المحتوى (`visit.previews_listed`).
   *
   * @param actor الفاعل
   * @param patientId الملف
   * @param cursor آخر صفحة
   * @returns الصفحة وأزرارها
   */
  list(actor: MedicalActor, patientId: string, cursor: string | undefined): Promise<VisitList> {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const ctx = readContext(this.deps, tx);
      const reach = visitViewReach(actor);
      if (reach === null) throw new ApiError("forbidden");
      const { patient, file } = await this.patientOf(ctx, actor, patientId);
      if ("own" in reach && !file.own) throw new ApiError("not_found");
      const content = readsContent(actor, file);
      const page = await listVisitPage(ctx, actor.clinicId, patientId, reach, cursor, content);
      if (page.previewsShown) await this.auditPatient(actor, ctx, patient, "visit.previews_listed");
      return {
        items: page.items,
        nextCursor: page.nextCursor,
        can: {
          search: content,
          start: canStart(actor, patient),
        },
      };
    });
  }

  /**
   * P2-F4: البحث جوه ملاحظات وملاحق مراجع واحد بيقرا محتواه (`visit.searched`، من غير الكلمة).
   *
   * @param actor الفاعل
   * @param patientId الملف
   * @param input الكلمة والـ cursor (في الجسم، R2-1)
   * @returns الزيارات المطابقة
   */
  search(actor: MedicalActor, patientId: string, input: VisitSearchInput): Promise<VisitList> {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const ctx = readContext(this.deps, tx);
      const { patient, file } = await this.patientOf(ctx, actor, patientId);
      if (!readsContent(actor, file)) throw new ApiError("not_found");
      // A content reader without a visits key searches every visit of a patient whose content it reads.
      const reach = visitViewReach(actor);
      const page = await searchVisitPage(
        ctx,
        actor.clinicId,
        patientId,
        reach,
        input.q,
        input.cursor,
      );
      await this.auditPatient(actor, ctx, patient, "visit.searched");
      return {
        ...page,
        can: {
          search: true,
          start: canStart(actor, patient),
        },
      };
    });
  }

  /**
   * R3-1: الفروع النشطة اللي الفاعل شغّال فيها، المصدر الوحيد لفروع صفحة الزيارة المباشرة.
   *
   * @param actor الفاعل (شايل `create:visits:own`)
   * @returns الفروع
   */
  walkInBranches(actor: MedicalActor): Promise<WalkInBranches> {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const all = await this.deps.branches.listForOptions(tx, actor.clinicId, actor.language);
      const items = all
        .filter((b) => b.isActive && worksIn(actor.member, b.id))
        .map((b) => ({ id: b.id, nameAr: b.nameAr, nameEn: b.nameEn }));
      return { items };
    });
  }

  /**
   * R3-1: ملفات نشطة متسجّلة في فرع الفاعل شغّال فيه، الاسم ورقم الملف بس، 20 بالكتير
   * (`visit.walk_in_searched` من غير الكلمة).
   *
   * @param actor الفاعل (شايل `create:visits:own`)
   * @param input الفرع والكلمة (في الجسم)
   * @returns المرشّحين
   */
  walkInCandidates(actor: MedicalActor, input: WalkInSearchInput): Promise<WalkInCandidates> {
    if (!worksIn(actor.member, input.branchId)) throw new ApiError("forbidden");
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      // As `start` (Codex 4241493936): a member of every branch still finds no file in a closed or
      // unknown branch, where no visit could start.
      const all = await this.deps.branches.listForOptions(tx, actor.clinicId, actor.language);
      const branch = all.find((b) => b.id === input.branchId);
      if (branch === undefined) throw new ApiError("not_found");
      if (!branch.isActive) throw new ApiError("branch_inactive");
      const items = await this.deps.patients.walkInCandidates(
        tx,
        actor.clinicId,
        input.branchId,
        input.q,
      );
      await auditMedical(tx, this.deps, actor, {
        action: "visit.walk_in_searched",
        entityType: "visit",
        entityId: null,
        branchId: input.branchId,
      });
      return { items: [...items] };
    });
  }

  // A file of this clinic and the caller's relation to it; another clinic's id is `not_found`.
  private async patientOf(ctx: ReadContext, actor: MedicalActor, patientId: string) {
    const patient = await ctx.patients.find(ctx.tx, actor.clinicId, patientId);
    if (patient === null) throw new ApiError("not_found");
    return { patient, file: await fileAccess(ctx.patients, ctx.tx, actor, patientId) };
  }

  // A read across a patient's visits names the patient (the audit screen links its file), never a visit.
  private auditPatient(
    actor: MedicalActor,
    ctx: ReadContext,
    patient: MedicalPatient,
    action: string,
  ) {
    return auditMedical(ctx.tx, this.deps, actor, {
      action,
      entityType: "patient",
      entityId: patient.id,
      branchId: patient.registrationBranchId,
    });
  }
}
