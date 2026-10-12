/** رسائل المراجع اللي بتطلع من تغييرات الموعد (N-1). */
export type AppointmentNoticeKind = "booked" | "rescheduled" | "cancelled";

/** رسالة موعد واحدة زي ما بتتحط في الطابور. */
export interface AppointmentNotice {
  readonly clinicId: string;
  readonly kind: AppointmentNoticeKind;
  readonly appointmentId: string;
  readonly patientId: string;
  /** بداية الموعد اللي الرسالة اتبنت عليها (ISO). */
  readonly startsAt: string;
  /** عضوية الفاعل اللي عمل التغيير. */
  readonly requestedBy: string;
}

/** الموعد بعد التغيير (للحجز والتغيير) أو قبله (للإلغاء: البداية مابتتغيرش). */
export interface NoticeAppointment {
  readonly id: string;
  readonly patientId: string;
  readonly startsAt: string;
}

/**
 * الرسالة اللي بتطلع من تغيير موعد (spec §3.1): الحجز والتغيير بيسمّوا البداية بعد التغيير، والإلغاء
 * البداية اللي كانت ليه. التغيير لنفس القيم والحالات التانية (حضر، اكتمل، لم يحضر) مابيطلعوش رسالة،
 * والمنادي مابينادي الدالة دي فيهم.
 *
 * @param kind نوع التغيير
 * @param appointment الموعد زي ما الرسالة لازم تسمّيه
 * @param actor العيادة وعضوية الفاعل
 * @returns الرسالة
 */
export function appointmentNotice(
  kind: AppointmentNoticeKind,
  appointment: NoticeAppointment,
  actor: { readonly clinicId: string; readonly membershipId: string },
): AppointmentNotice {
  return {
    clinicId: actor.clinicId,
    kind,
    appointmentId: appointment.id,
    patientId: appointment.patientId,
    startsAt: appointment.startsAt,
    requestedBy: actor.membershipId,
  };
}
