import {
  REMINDER_KINDS,
  type NotificationKind,
  type NotificationSettings,
  type NotificationSkipReason,
} from "@eyadex/contracts/notifications";

/** الموعد وقت الإرسال، مقري تحت القفل. */
export interface AppointmentNow {
  readonly status: "booked" | "arrived" | "completed" | "no_show" | "cancelled";
  /** `starts_at` لسه هو `subject_at` اللي الرسالة اتبنت عليه؟ (المقارنة في SQL، بكل الـ microseconds) */
  readonly startUnchanged: boolean;
}

/** كل اللي قرار التخطي محتاجه، مقري وقت الإرسال (كل واحد ممكن يتغيّر بعد ما الرسالة اتسجّلت). */
export interface SendFacts {
  readonly kind: NotificationKind;
  readonly settings: NotificationSettings;
  readonly patient: { readonly email: string | null; readonly optedOut: boolean };
  /** الموعد لرسايل المواعيد؛ `null` للوصفة. */
  readonly appointment: AppointmentNow | null;
  /** لصفوف واتساب بس (N2): حالة قناة العيادة وقت الإرسال؛ مش موجودة = صف إيميل. */
  readonly whatsapp?: WhatsappFacts;
}

/** قناة واتساب العيادة وقت الإرسال (spec §7.1). */
export interface WhatsappFacts {
  /** Evolution مضبوط في الـ worker، والقناة `connected` وليها instance. */
  readonly connected: boolean;
  /** coexistence ومفيش قالب Meta لنوع الرسالة. */
  readonly templateMissing: boolean;
}

/**
 * قرار وقت الإرسال (spec §3.3)، بالترتيب: العيادة قفلت القناة أو نوع الرسالة → `setting_off`؛ (إيميل)
 * المراجع مالوش إيميل → `no_email`؛ تذكير والمراجع طالب مايوصلوش تذكير → `opted_out` (الاختيار ده بيوقف
 * التذكيرين بس، N-2)؛ رسالة موعد غير الإلغاء والموعد مابقاش `booked` → `not_booked`؛ الموعد اتنقل لوقت
 * تاني → `moved`. واتساب (§7.1) بعد كل دول: القناة مش متوصلة → `whatsapp_disconnected`، ثم coexistence
 * من غير قالب للنوع → `template_missing` — الرسالة اللي مابقتش مطلوبة بتتقال كده قبل عجز القناة.
 *
 * @param facts الحالة دلوقتي
 * @returns سبب التخطي، أو `null` لو الرسالة تتبعت
 */
export function notificationSkip(facts: SendFacts): NotificationSkipReason | null {
  const { kind, settings, patient, appointment, whatsapp } = facts;
  const channelOn = whatsapp === undefined ? settings.emailEnabled : settings.whatsappEnabled;
  if (!channelOn || !settings.messages[kind]) return "setting_off";
  if (whatsapp === undefined && patient.email === null) return "no_email";
  if (patient.optedOut && REMINDER_KINDS.includes(kind)) return "opted_out";
  if (appointment !== null) {
    if (kind !== "cancelled" && appointment.status !== "booked") return "not_booked";
    if (!appointment.startUnchanged) return "moved";
  }
  if (whatsapp === undefined) return null;
  if (!whatsapp.connected) return "whatsapp_disconnected";
  if (whatsapp.templateMissing) return "template_missing";
  return null;
}
