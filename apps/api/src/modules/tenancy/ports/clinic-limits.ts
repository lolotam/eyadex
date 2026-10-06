import type { LimitCheck } from "../domain/limits.ts";

/**
 * فحص الحدود قبل أي إضافة أو إعادة تفعيل (PRD §4.9، SUB-03). slices 6–7 بتنده عليه قبل ما تكتب،
 * ولو رجع `exceeded` بترفض بـ `limit_reached` ومعاه `limitReachedDetails`.
 */
export interface ClinicLimits {
  /**
   * هل ينفع نضيف مستخدم (دعوة جديدة أو إعادة تفعيل عضوية)؟
   *
   * @param clinicId uuid العيادة
   * @returns `within` أو `exceeded` ومعاه الاستهلاك؛ العيادة مش ظاهرة → يرمي `not_found`
   */
  canAddUser(clinicId: string): Promise<LimitCheck>;
  /**
   * هل ينفع نضيف فرع (أو نعيد تفعيله)؟
   *
   * @param clinicId uuid العيادة
   * @returns `within` أو `exceeded` ومعاه الاستهلاك؛ العيادة مش ظاهرة → يرمي `not_found`
   */
  canAddBranch(clinicId: string): Promise<LimitCheck>;
}

export const CLINIC_LIMITS = Symbol("tenancy.ClinicLimits");
