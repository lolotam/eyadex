import type { Tx } from "@eyadex/db";

/** موعد زي ما بداية الزيارة محتاجاه: الفرع والمراجع ومقدّم الخدمة والحالة. */
export interface VisitAppointment {
  readonly id: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly providerMembershipId: string;
  readonly status: string;
}

/**
 * اللي موديول الطب محتاجه من المواعيد (ملك appointments) عشان يبدأ زيارة من موعد (P2-2). موديول المواعيد
 * بينفّذه (`PgVisitAppointments`)، والربط في `medical.module.ts` بس (ADR-0029).
 */
export interface MedicalAppointmentReader {
  /**
   * الموعد من غير قفل: بيعرّف مقدّم الخدمة اللي قفله لازم ييجي الأول.
   *
   * @param tx transaction الطب جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param appointmentId الموعد
   * @returns الموعد، أو `null` لو مش موعد في العيادة دي
   */
  find(tx: Tx, clinicId: string, appointmentId: string): Promise<VisitAppointment | null>;

  /**
   * الموعد وصفّه مقفول `FOR SHARE` بعد قفل مقدّم الخدمة (ترتيب ADR-0027: صف الموعد قبل صف العضوية)،
   * فتغيير حالته بالتوازي بيستنى لحد ما الزيارة تتسجّل.
   *
   * @param tx transaction الطب وماسكة قفل مقدّم الخدمة
   * @param clinicId العيادة
   * @param appointmentId الموعد
   * @returns الموعد، أو `null`
   */
  lockForVisit(tx: Tx, clinicId: string, appointmentId: string): Promise<VisitAppointment | null>;
}
