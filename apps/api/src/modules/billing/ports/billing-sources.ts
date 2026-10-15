import type { Tx } from "@eyadex/db";

/** حقايق المصدر اللي الفاتورة بتتبني منها: المراجع والفرع والدكتور والخدمة. */
export interface SourceFacts {
  readonly patientId: string;
  readonly branchId: string;
  readonly providerId: string;
  readonly serviceId: string | null;
}

/** بيقرا موعد للفاتورة (بيتربط بـ adapter موديول المواعيد في `billing.module.ts`). */
export interface BillingAppointmentReader {
  /**
   * الموعد بالمراجع والفرع والدكتور والخدمة، من غير ملاحظة الإلغاء.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param appointmentId الموعد
   * @returns الحقايق، أو `null` لو مش موجود في العيادة
   */
  find(tx: Tx, clinicId: string, appointmentId: string): Promise<SourceFacts | null>;
}

/** بيقرا زيارة للفاتورة (بيتربط بـ adapter موديول الطب في `billing.module.ts`). */
export interface BillingVisitReader {
  /**
   * الزيارة بالمراجع والفرع والدكتور وموعدها لو ليها موعد، من غير أي محتوى طبي.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param visitId الزيارة
   * @returns الحقايق، أو `null` لو مش موجودة في العيادة
   */
  find(
    tx: Tx,
    clinicId: string,
    visitId: string,
  ): Promise<{
    readonly patientId: string;
    readonly branchId: string;
    readonly providerId: string;
    readonly appointmentId: string | null;
  } | null>;
}
