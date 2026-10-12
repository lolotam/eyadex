import {
  NOTIFICATION_KINDS,
  type NotificationKind,
  type NotificationSettings,
} from "@eyadex/contracts/notifications";

/**
 * هل الرسالة دي تتحط في الطابور دلوقتي (N-1)؟ بريد العيادة شغّال والرسالة نفسها شغّالة. إيميل المراجع
 * وطلبه بعدم التذكير مش هنا: بيتقرروا وقت الإرسال عشان ممكن يتغيّروا في النص (spec §3.1).
 *
 * @param settings إعدادات العيادة (أو الافتراضي لو ماحفظتش)
 * @param kind نوع الرسالة
 * @returns `true` لو تتحط في الطابور
 */
export function shouldQueue(settings: NotificationSettings, kind: NotificationKind): boolean {
  return settings.emailEnabled && settings.messages[kind];
}

/** موضوع الرسالة زي ما السجل بيحفظه (قيود 0056). */
export interface NotificationSubject {
  readonly subjectType: "appointment" | "visit";
  readonly subjectId: string;
  /** بداية الموعد اللي الرسالة اتبنت عليها (ISO)؛ `null` للروشتة بس. */
  readonly subjectAt: string | null;
}

/**
 * موضوع الرسالة من نوعها: الروشتة بس رسالة زيارة من غير وقت، وكل رسالة موعد لازم تسمّي بداية الموعد
 * اللي اتبنت عليها (0056، قيد `patient_notifications_subject_check`). أي خلط = خطأ برمجي مش رفض.
 *
 * @param kind نوع الرسالة
 * @param subjectId الموعد أو الزيارة
 * @param startsAt بداية الموعد (ISO) لرسالة موعد، و`null` للروشتة
 * @returns الموضوع
 */
export function subjectOf(
  kind: NotificationKind,
  subjectId: string,
  startsAt: string | null,
): NotificationSubject {
  if (kind === "prescription") {
    if (startsAt !== null) throw new Error("a prescription message names no appointment start");
    return { subjectType: "visit", subjectId, subjectAt: null };
  }
  if (startsAt === null) throw new Error(`a ${kind} message needs the appointment start`);
  return { subjectType: "appointment", subjectId, subjectAt: new Date(startsAt).toISOString() };
}

/**
 * هل الإعدادات الجديدة زي المحفوظة؟ نفس القيم = مفيش كتابة ولا صف سجل.
 *
 * @param before المحفوظ (أو الافتراضي)
 * @param after الجديد
 * @returns `true` لو مفيش أي فرق
 */
export function sameSettings(before: NotificationSettings, after: NotificationSettings): boolean {
  return (
    before.emailEnabled === after.emailEnabled &&
    NOTIFICATION_KINDS.every((kind) => before.messages[kind] === after.messages[kind])
  );
}
