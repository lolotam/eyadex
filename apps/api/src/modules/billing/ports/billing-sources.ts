import type { AppointmentStatus } from "@eyadex/contracts/appointments";
import type { Tx } from "@eyadex/db";

/** حقايق المصدر اللي الفاتورة بتتبني منها: المراجع والفرع والدكتور والخدمة. */
export interface SourceFacts {
  readonly patientId: string;
  readonly branchId: string;
  readonly providerId: string;
  readonly serviceId: string | null;
}

/** حقايق الموعد: زي أي مصدر، ومعاها حالته (موعد ملغي أو محضرش مالوش فاتورة منه، FIN-9). */
export interface AppointmentFacts extends SourceFacts {
  readonly status: AppointmentStatus;
}

/** بيقرا موعد للفاتورة (بيتربط بـ adapter موديول المواعيد في `billing.module.ts`). */
export interface BillingAppointmentReader {
  /**
   * الموعد بالمراجع والفرع والدكتور والخدمة والحالة، من غير ملاحظة الإلغاء.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param appointmentId الموعد
   * @returns الحقايق، أو `null` لو مش موجود في العيادة
   */
  find(tx: Tx, clinicId: string, appointmentId: string): Promise<AppointmentFacts | null>;

  /**
   * نفس `find` بس صف الموعد `FOR UPDATE` (ADR-0027: صف الموعد قبل صف المراجع)، عشان إلغاء أو نقل بيحصل
   * مع الإصدار يخلص الأول والإصدار يحكم على حالته وفرعه الجديدين.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param appointmentId الموعد
   * @returns الحقايق، أو `null` لو مش موجود في العيادة
   */
  lockForInvoice(tx: Tx, clinicId: string, appointmentId: string): Promise<AppointmentFacts | null>;
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

  /**
   * زيارات الموعد (الزيارة اللي اتعملت منه)، عشان المراجع ميتحاسبش مرتين على نفس الكشف: مرة على الموعد
   * ومرة على زيارته.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param appointmentId الموعد
   * @returns ids الزيارات، أو مصفوفة فاضية
   */
  idsForAppointment(tx: Tx, clinicId: string, appointmentId: string): Promise<string[]>;
}
