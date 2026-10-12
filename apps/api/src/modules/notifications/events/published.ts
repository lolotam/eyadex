import type { OutboxEvent } from "../../../shared/outbox.ts";

/**
 * رسالة لمراجع اتحطت في الطابور (spec §3، ADR-0031): الـ worker بيستلم الحدث، يقفل صف السجل، ويقرر وقت
 * الإرسال (الإعداد، الإيميل، طلب عدم التذكير، حالة الموعد) قبل ما يبعت.
 */
export const PATIENT_NOTIFICATION_REQUESTED = "patient.notification_requested";

/** payload الحدث: id صف السجل بس — مفيش أي بيان شخصي في الـ outbox. */
export interface PatientNotificationRequested {
  readonly notificationId: string;
}

/**
 * بيبني حدث طلب الرسالة.
 *
 * @param id id الحدث
 * @param clinicId العيادة (لازم تساوي سياق الـ transaction، RLS)
 * @param createdAt وقت الطلب
 * @param payload id صف السجل
 * @returns صف الـ outbox
 */
export function publishNotificationRequested(
  id: string,
  clinicId: string,
  createdAt: Date,
  payload: PatientNotificationRequested,
): OutboxEvent {
  return {
    id,
    clinicId,
    type: PATIENT_NOTIFICATION_REQUESTED,
    payload: { notificationId: payload.notificationId },
    createdAt,
  };
}
