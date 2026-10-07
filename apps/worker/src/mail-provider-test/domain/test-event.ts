import { z } from "zod";

/** الحدث اللي الـ API بيكتبه لما الأدمن يطلب إيميل تجربة لمزود العيادة (ADR-0014، 7c-2a). */
export const MAIL_PROVIDER_TEST_REQUESTED = "clinic.mail_provider_test_requested";

const schema = z
  .object({
    clinicId: z.string().uuid(),
    providerId: z.string().uuid(),
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
 * الصف اتغيّر بعد الطلب؟ الـ API بيكتب `updated_at` و`created_at` الحدث من نفس الساعة، والتجربة نفسها
 * ما بتلمسش `updated_at`، فصف أحدث من الحدث معناه إن الإعدادات اتبدّلت ومش هي اللي اتطلب تجربتها.
 *
 * @param providerUpdatedAt `clinic_mail_providers.updated_at`
 * @param eventCreatedAt `outbox_events.created_at`
 * @returns `true` لو لازم نتخطّى من غير كتابة
 */
export function isSuperseded(providerUpdatedAt: Date, eventCreatedAt: Date): boolean {
  return providerUpdatedAt.getTime() > eventCreatedAt.getTime();
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
