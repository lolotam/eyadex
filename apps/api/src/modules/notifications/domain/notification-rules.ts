import {
  NOTIFICATION_KINDS,
  type NotificationChannel,
  type NotificationKind,
  type NotificationSettings,
} from "@eyadex/contracts/notifications";

/**
 * هل واتساب ممكن ياخد الرسالة دي (spec §7.1)؟ واتساب العيادة شغّال والرسالة نفسها شغّالة؛ ربط القناة
 * بيتقري بعدها بس لو الإجابة نعم.
 *
 * @param settings إعدادات العيادة (أو الافتراضي لو ماحفظتش)
 * @param kind نوع الرسالة
 * @returns `true` لو لازم نشوف القناة مربوطة ولا لأ
 */
export function wantsWhatsapp(settings: NotificationSettings, kind: NotificationKind): boolean {
  return settings.whatsappEnabled && settings.messages[kind];
}

/**
 * القنوات اللي الرسالة دي تتحط في طابورها دلوقتي (N-1، spec §7.1): البريد لو بريد العيادة والرسالة
 * شغّالين، وواتساب لو واتساب العيادة والرسالة شغّالين والقناة `connected` وقت الطابور. إيميل المراجع
 * وموبايله وطلبه بعدم التذكير مش هنا: بيتقرروا وقت الإرسال عشان ممكن يتغيّروا في النص (spec §3.1).
 *
 * @param settings إعدادات العيادة (أو الافتراضي لو ماحفظتش)
 * @param kind نوع الرسالة
 * @param whatsappConnected قناة واتساب العيادة `connected` دلوقتي
 * @returns القنوات بالترتيب (البريد الأول)، أو قايمة فاضية
 */
export function queuedChannels(
  settings: NotificationSettings,
  kind: NotificationKind,
  whatsappConnected: boolean,
): NotificationChannel[] {
  const channels: NotificationChannel[] = [];
  if (settings.emailEnabled && settings.messages[kind]) channels.push("email");
  if (wantsWhatsapp(settings, kind) && whatsappConnected) channels.push("whatsapp");
  return channels;
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
    before.whatsappEnabled === after.whatsappEnabled &&
    NOTIFICATION_KINDS.every((kind) => before.messages[kind] === after.messages[kind])
  );
}
