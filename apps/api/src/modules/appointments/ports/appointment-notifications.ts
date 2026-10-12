import type { PatientNotificationList } from "@eyadex/contracts/notifications";
import type { Tx } from "@eyadex/db";

import type { AppointmentNotice } from "../domain/appointment-notices.ts";

/**
 * منفذ رسائل المراجع الخاصة بالمواعيد (ADR-0031): بتنفّذه notifications (`PgAppointmentNotifications`)
 * ومربوط في appointments.module.ts، فموديول المواعيد عمره ما بيسمّي جداول الرسائل.
 */
export interface AppointmentNotifications {
  /**
   * بيحط رسالة الحجز أو التغيير أو الإلغاء في الطابور جوه transaction الـ use case، بعد أقفاله كلها. لو
   * بريد العيادة أو الرسالة مقفولة، أو الرسالة دي اتحطت قبل كده لنفس البداية، مفيش حاجة بتتكتب.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param notice الرسالة
   * @returns `true` لو اتحط صف وحدث outbox
   */
  queue(tx: Tx, notice: AppointmentNotice): Promise<boolean>;

  /**
   * تاريخ رسائل موعد، الأحدث الأول. المنادي هو اللي بيقرر إن الفاعل يقدر يشوف الموعد.
   *
   * @param tx الـ transaction جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param appointmentId الموعد
   * @returns الرسائل (من غير عنوان ولا نص)
   */
  history(tx: Tx, clinicId: string, appointmentId: string): Promise<PatientNotificationList>;
}
