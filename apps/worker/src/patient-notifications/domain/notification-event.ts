import { z } from "zod";

/** الحدث اللي الـ API والـ scanner بيكتبوه لكل صف في دفتر رسايل المراجعين (spec §3). */
export const PATIENT_NOTIFICATION_REQUESTED = "patient.notification_requested";

// The payload is the ledger id only: no address and no text ever enters the outbox (spec §2).
const schema = z.object({ notificationId: z.string().uuid() }).strict();

/** الحدث بعد التحقق: العيادة من صف الـ outbox، والصف من الـ payload. */
export interface NotificationEvent {
  readonly clinicId: string;
  readonly notificationId: string;
}

/**
 * بيتحقق من payload الحدث. العيادة بتيجي من `outbox_events.clinic_id`، مش من الـ payload.
 *
 * @param payload الـ payload كما هو في الصف
 * @param eventClinicId `outbox_events.clinic_id`
 * @returns الحدث، أو `null` لو بايظ أو من غير عيادة (فشل فوري، مفيش retry يصلّحه)
 */
export function parseNotificationEvent(
  payload: unknown,
  eventClinicId: string | null,
): NotificationEvent | null {
  const parsed = schema.safeParse(payload);
  if (!parsed.success || eventClinicId === null) return null;
  return { clinicId: eventClinicId, notificationId: parsed.data.notificationId };
}
