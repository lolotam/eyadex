/** رسالة الروشتة لزيارة اتعتمدت (N-5). */
export interface PrescriptionNotice {
  readonly clinicId: string;
  readonly visitId: string;
  readonly patientId: string;
  /** عضوية الطبيب اللي اعتمد. */
  readonly requestedBy: string;
}

/**
 * رسالة الروشتة بتطلع بس لما الزيارة اللي اتعتمدت فيها سطور روشتة نشطة (N-5)؛ زيارة من غير روشتة
 * مابتطلعش رسالة، والملحق بعد الاعتماد عمره ما بيبعتها تاني.
 *
 * @param visit الزيارة المعتمدة
 * @param prescriptionLines عدد سطور الروشتة النشطة وقت الاعتماد
 * @param actor العيادة وعضوية الطبيب
 * @returns الرسالة، أو `null` لو مفيش روشتة
 */
export function prescriptionNotice(
  visit: { readonly id: string; readonly patientId: string },
  prescriptionLines: number,
  actor: { readonly clinicId: string; readonly membershipId: string },
): PrescriptionNotice | null {
  if (prescriptionLines === 0) return null;
  return {
    clinicId: actor.clinicId,
    visitId: visit.id,
    patientId: visit.patientId,
    requestedBy: actor.membershipId,
  };
}
