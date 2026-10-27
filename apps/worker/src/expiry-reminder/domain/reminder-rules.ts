import { utcDatetime } from "@eyadex/contracts/datetime-compat";
import { legacyInteger } from "@eyadex/contracts/integer-compat";
import { legacyNumber } from "@eyadex/contracts/number-compat";
import { z } from "zod";

/** الحدث اللي الفحص بيكتبه لما عيادة تدخل نافذة التنبيه (ADR-0020، story 79). */
export const EXPIRY_REMINDER = "clinic.expiry_reminder";

const DAY_MS = 24 * 60 * 60 * 1000;

/** حالة العيادة اللي القرار محتاجها. */
export interface ClinicTerm {
  readonly status: "trial" | "active" | "suspended";
  readonly expiresAt: Date;
}

/**
 * هل العيادة جوه نافذة التنبيه دلوقتي؟ مش موقوفة، ولسه ماانتهتش (الانتهاء حصري عند اللحظة نفسها زي
 * حارس الـ API)، وانتهاؤها في خلال `alertDays` يوم من دلوقتي.
 *
 * @param clinic حالة العيادة وانتهاؤها
 * @param alertDays أيام التنبيه من إعدادات المنصة
 * @param now الوقت من الـ Clock
 * @returns `true` لو التنبيه مستحق
 */
export function isDue(clinic: ClinicTerm, alertDays: number, now: Date): boolean {
  const left = clinic.expiresAt.getTime() - now.getTime();
  return clinic.status !== "suspended" && left > 0 && left <= alertDays * DAY_MS;
}

/** حمولة الحدث بعد التحقق. */
export interface ReminderEvent {
  readonly clinicId: string;
  readonly reminderId: string;
  /** الانتهاء اللي التنبيه اتعمل عشانه: لو اتغيّر (تجديد) الإيميل مابيتبعتش. */
  readonly expiresAt: string;
  /** المستلم: حدث لكل أدمن، فمحاولة فاشلة لواحد ماتعطّلش الباقيين. */
  readonly membershipId: string;
  /** الأيام الباقية وقت الفحص: ثابتة بين المحاولات، فجسم الرسالة مايتغيرش تحت نفس مفتاح الـ idempotency. */
  readonly daysLeft: number;
}

const payloadSchema = z
  .object({
    clinicId: z.string().guid(),
    reminderId: z.string().guid(),
    expiresAt: utcDatetime(),
    membershipId: z.string().guid(),
    daysLeft: legacyNumber().check(legacyInteger()).check(z.gte(1)).check(z.lte(60)),
  })
  .strict();

/**
 * يقرا الحمولة؛ حمولة غلط أو عيادة غير عيادة الصف → `null` (ولا محاولة تانية تصلّحها).
 *
 * @param payload الحمولة كما اتخزنت
 * @param rowClinicId `clinic_id` بتاع صف الـ outbox
 * @returns الحدث أو `null`
 */
export function parseReminderEvent(
  payload: unknown,
  rowClinicId: string | null,
): ReminderEvent | null {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success || parsed.data.clinicId !== rowClinicId) return null;
  return parsed.data;
}

/** سبب عدم الإرسال وقت الإرسال، أو `null` = ابعت. */
export type ReminderSkip = "missing" | "suspended" | "expired" | "renewed" | "not_admin";

/**
 * القرار وقت الإرسال (بعد الفحص بفترة): العيادة لسه موجودة، مش موقوفة، ماانتهتش، وانتهاؤها هو نفسه
 * اللي التنبيه اتعمل عشانه، والمستلم لسه أدمن نشط.
 *
 * @param state العيادة والمستلم (`null` لو مابقاش أدمن نشط)، أو `null`
 * @param event الحدث
 * @param now الوقت من الـ Clock
 * @returns سبب التخطي أو `null`
 */
export function reminderSkip(
  state: { clinic: ClinicTerm; recipient: unknown } | null,
  event: ReminderEvent,
  now: Date,
): ReminderSkip | null {
  if (state === null) return "missing";
  if (state.clinic.status === "suspended") return "suspended";
  if (state.clinic.expiresAt.getTime() <= now.getTime()) return "expired";
  if (state.clinic.expiresAt.getTime() !== new Date(event.expiresAt).getTime()) return "renewed";
  if (state.recipient === null) return "not_admin";
  return null;
}

/**
 * الأيام الكاملة الباقية، مقرّبة لفوق (زي شريط التنبيه في الواجهة).
 *
 * @param expiresAt الانتهاء
 * @param now الوقت
 * @returns عدد الأيام
 */
export function daysLeft(expiresAt: Date, now: Date): number {
  return Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS);
}
