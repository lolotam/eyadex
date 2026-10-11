import type { PrescriptionPrint } from "@eyadex/contracts/visits";

import { ApiError } from "../../../../shared/errors.ts";
import type { MedicalActor } from "../../domain/visit-rules.ts";
import { prescriptionOf } from "../../persistence/pg-prescription-store.ts";
import { openPrescription } from "../../queries/visit-lists-view.ts";
import { readsContent, visitSummary } from "../../queries/visit-views.ts";
import { auditMedical, type MedicalDeps } from "../medical-deps.ts";
import { readContext, seeVisit } from "../visit-access.ts";

// The FK makes a missing name impossible; the dash is the placeholder all the same.
const NO_NAME = "—";

/**
 * طباعة الروشتة (P2-9، R2-10): العيادة والفرع والمراجع ومقدّم الخدمة والتاريخ والأدوية النشطة. الزيارة
 * لازم تكون في وصول عرض الزيارات، والمحتوى في وصول `view:medical:*` (غير كده `not_found`)، وكل طباعة
 * بتكتب صف `patient_access` (`visit.prescription_printed`) من غير أي دوا.
 */
export class PrescriptionPrints {
  constructor(private readonly deps: MedicalDeps) {}

  /**
   * بيانات الطباعة لزيارة (مسودة كمان: التاريخ `signedAt ?? startedAt` بيختاره العرض).
   *
   * @param actor الفاعل
   * @param visitId الزيارة
   * @returns بيانات الطباعة
   */
  print(actor: MedicalActor, visitId: string): Promise<PrescriptionPrint> {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const ctx = readContext(this.deps, tx);
      const { clinicId } = actor;
      const { visit, patientIsOwn } = await seeVisit(ctx, actor, visitId);
      if (!readsContent(actor, patientIsOwn)) throw new ApiError("not_found");
      const items = openPrescription(
        this.deps.cipher,
        clinicId,
        await prescriptionOf(tx, clinicId, [visit.id]),
      );
      const clinic = (await this.deps.clinics.namesOf(tx, [clinicId])).get(clinicId);
      const branch = (await ctx.branches.namesOf(tx, clinicId, [visit.branchId])).get(
        visit.branchId,
      );
      const patient = (await ctx.patients.labels(tx, clinicId, [visit.patientId])).get(
        visit.patientId,
      );
      const provider = (await ctx.members.findMany(tx, clinicId, [visit.providerMembershipId])).get(
        visit.providerMembershipId,
      );
      const summary = visitSummary(visit, provider?.fullName ?? NO_NAME, null);
      await auditMedical(tx, this.deps, actor, {
        action: "visit.prescription_printed",
        entityType: "prescription",
        entityId: visit.id,
        branchId: visit.branchId,
      });
      return {
        clinic: { nameAr: clinic?.nameAr ?? NO_NAME, nameEn: clinic?.nameEn ?? NO_NAME },
        branch: { nameAr: branch?.nameAr ?? NO_NAME, nameEn: branch?.nameEn ?? NO_NAME },
        patient: { fullName: patient?.fullName ?? NO_NAME, fileNumber: patient?.fileNumber ?? 0 },
        providerName: summary.providerName,
        startedAt: summary.startedAt,
        signedAt: summary.signedAt,
        items,
      };
    });
  }
}
