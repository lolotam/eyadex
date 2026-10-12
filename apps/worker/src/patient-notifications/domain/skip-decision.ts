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
}

/**
 * قرار وقت الإرسال (spec §3.3)، بالترتيب: العيادة قفلت الإيميل أو نوع الرسالة → `setting_off`؛ المراجع
 * مالوش إيميل → `no_email`؛ تذكير والمراجع طالب مايوصلوش تذكير → `opted_out` (الاختيار ده بيوقف
 * التذكيرين بس، N-2)؛ رسالة موعد غير الإلغاء والموعد مابقاش `booked` → `not_booked`؛ الموعد اتنقل لوقت
 * تاني → `moved`.
 *
 * @param facts الحالة دلوقتي
 * @returns سبب التخطي، أو `null` لو الرسالة تتبعت
 */
export function notificationSkip(facts: SendFacts): NotificationSkipReason | null {
  const { kind, settings, patient, appointment } = facts;
  if (!settings.emailEnabled || !settings.messages[kind]) return "setting_off";
  if (patient.email === null) return "no_email";
  if (patient.optedOut && REMINDER_KINDS.includes(kind)) return "opted_out";
  if (appointment === null) return null;
  if (kind !== "cancelled" && appointment.status !== "booked") return "not_booked";
  if (!appointment.startUnchanged) return "moved";
  return null;
}
