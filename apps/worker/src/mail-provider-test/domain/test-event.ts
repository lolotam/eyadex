import { mailProviderSlotSchema } from "@eyadex/contracts/notifications";
import { z } from "zod";

/** الحدث اللي الـ API بيكتبه لما الأدمن يطلب إيميل تجربة لمزود العيادة (ADR-0014، 7c-2a). */
export const MAIL_PROVIDER_TEST_REQUESTED = "clinic.mail_provider_test_requested";

const schema = z
  .object({
    clinicId: z.string().uuid(),
    providerId: z.string().uuid(),
    // Pending events written before dual slots still target the primary provider.
    slot: mailProviderSlotSchema.default("primary"),
    providerVersion: z.number().int().min(1),
    actorUserId: z.string().uuid(),
  })
  .strict();

/** payload حدث التجربة بعد التحقق: ids بس، مفيش إيميل ولا سر. */
export type MailProviderTestEvent = z.output<typeof schema>;

/**
 * يتحقق من payload الحدث ومن إن عيادته هي عيادة صف الـ outbox.
 *
 * @param payload الـ payload كما هو في الصف
 * @param eventClinicId `outbox_events.clinic_id`
 * @returns الحدث، أو `null` لو بايظ أو لعيادة تانية (فشل فوري، مفيش retry يصلّحه)
 */
export function parseMailProviderTest(
  payload: unknown,
  eventClinicId: string | null,
): MailProviderTestEvent | null {
  const parsed = schema.safeParse(payload);
  if (!parsed.success || parsed.data.clinicId !== eventClinicId) return null;
  return parsed.data;
}

/**
 * الصف اتبدّل بعد الطلب؟ كل استبدال بيزوّد `version` في نفس الـ transaction، والتجربة نفسها
 * مابتغيّروش، فإصدار مختلف معناه إن الإعدادات اللي اتطلبت تجربتها مابقتش موجودة — من غير مقارنة ساعات.
 *
 * @param providerVersion `clinic_mail_providers.version` تحت القفل
 * @param requestedVersion الإصدار اللي في الحدث
 * @returns `true` لو لازم نتخطّى من غير كتابة
 */
export function isSuperseded(providerVersion: number, requestedVersion: number): boolean {
  return providerVersion !== requestedVersion;
}

/** رسالة التجربة الثابتة، عربي وإنجليزي في نفس الإيميل. مفيش بيانات من الطلب غير اسم المرسل. */
export const TEST_MESSAGE = {
  subject: "Eyadex — رسالة تجربة / test message",
  text: [
    "هذه رسالة تجربة من Eyadex للتأكد من إعدادات بريد العيادة. لا يلزم أي إجراء.",
    "",
    "This is a test message from Eyadex to confirm your clinic's mail settings. No action is needed.",
  ].join("\n"),
  html: [
    "<!doctype html><html><body>",
    '<p dir="rtl" lang="ar">هذه رسالة تجربة من Eyadex للتأكد من إعدادات بريد العيادة. لا يلزم أي إجراء.</p>',
    '<p dir="ltr" lang="en">This is a test message from Eyadex to confirm your clinic&#39;s mail settings. No action is needed.</p>',
    "</body></html>",
  ].join(""),
} as const;
