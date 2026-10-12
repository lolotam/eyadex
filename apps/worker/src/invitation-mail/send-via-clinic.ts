import type { SecretSealer } from "@eyadex/secrets";

import { credentialsOf } from "../mail-provider-test/domain/credentials.ts";
import type { ClinicSenderFactory } from "../mail-provider-test/ports/clinic-sender-factory.ts";
import { isDefinitiveClinicFailure } from "./domain/clinic-failure.ts";
import type { LockedClinicProvider } from "./ports/invitation-state-reader.ts";
import type { MailMessage, MailResult } from "./ports/mail-sender.ts";

export interface ClinicMailDeps {
  /** مفتاح `MAIL_PROVIDER_SEAL_KEY`. */
  readonly sealer: SecretSealer;
  /** المسار الوحيد لبناء مرسل العيادة: فيه حارس SSRF والتثبيت على العناوين. */
  readonly senders: ClinicSenderFactory;
  /** `MAIL_FROM` المنصة: عنوانه بيتستخدم في الإرسال بالنيابة. */
  readonly platformFrom: string;
}

/**
 * بيبعت رسالة واحدة عبر مزود عيادة ممسوك (ADR-0014، 7c-2b): يفتح الختم بـ id الصف، يبني المرسل من
 * المصنع، يبعت باسم العيادة وعنوانها، وبيكتب النتيجة على الصف في نفس الـ transaction (النجاح بيصفّر العداد،
 * الفشل الأكيد بيزوّده وممكن يحوّل المزود). مفيش بديل جوه المحاولة: القرار ده عند اللي بينادي.
 *
 * @param clinic الختم والمصنع
 * @param locked صف المزود ممسوك `FOR UPDATE`
 * @param message الرسالة من غير `from`
 * @param now الوقت اللي بيتكتب مع الفشل الأكيد
 * @returns نتيجة الإرسال، وهل المزود اتحوّل للمنصة دلوقتي
 */
export async function sendViaClinic(
  clinic: ClinicMailDeps,
  locked: LockedClinicProvider,
  message: MailMessage,
  now: () => Date,
): Promise<{ result: MailResult; degraded: boolean }> {
  const { row } = locked;
  let result: MailResult;
  let secret: string | null = null;
  try {
    secret = clinic.sealer.open(row.sealedCredentials, row.id);
  } catch {
    // Counted as definitive below: a seal that never opens will not open on a retry either.
  }
  const credentials = secret === null ? null : credentialsOf(row, secret);
  if (secret === null) {
    result = { sent: false, error: "seal_unreadable" };
  } else if (credentials === null) {
    result = { sent: false, error: "invalid_provider" };
  } else {
    const sender = await clinic.senders.open(credentials);
    try {
      result = await sender.sender.send({
        ...message,
        from: { name: row.fromName, address: row.fromEmail },
        ...(row.replyTo === null ? {} : { replyTo: row.replyTo }),
      });
    } finally {
      sender.close();
    }
  }
  const degraded = await locked.record(
    result.sent
      ? { ok: true }
      : {
          ok: false,
          error: result.error,
          definitive: isDefinitiveClinicFailure(result.error),
          at: now(),
        },
  );
  return {
    result: result.sent ? { sent: true, provider: row.kind, fallback: false } : result,
    degraded,
  };
}
