/** رسالة واحدة جاهزة للإرسال. المحتوى متعمل escape قبل ما يوصل هنا. */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** id حدث الـ outbox: مزود بيحترمه ما بيبعتش نفس الرسالة مرتين لو الـ commit وقع بعد الإرسال. */
  readonly idempotencyKey: string;
  /** مرسل غير `MAIL_FROM` (مزود العيادة، 7c-2). من غيره المزود بيستخدم المرسل المضبوط عنده. */
  readonly from?: MailAddress;
  /** عنوان الرد، لو موجود. */
  readonly replyTo?: string;
}

/** اسم ظاهر + عنوان. الاسم بيتنضف من أسطر جديدة قبل ما يتحط في الهيدر. */
export interface MailAddress {
  readonly name: string;
  readonly address: string;
}

/** المزود اللي قبل الرسالة فعلاً. */
export type MailProvider = "resend" | "smtp";

/**
 * نتيجة الإرسال. `error` كود قصير بس (حالة HTTP أو اسم خطأ المزود) — عمره ما بيحمل الرابط ولا
 * العنوان ولا جسم الرد، لأنه بيتكتب في `outbox_events.last_error`. في النجاح: مين بعت، وهل كان بديل.
 */
export type MailResult =
  | { readonly sent: true; readonly provider: MailProvider; readonly fallback: boolean }
  | { readonly sent: false; readonly error: string };

/**
 * منفذ الإيميل (ADR-0013، ADR-0014). Resend أساسي؛ SMTP المنصة بديل بيطبّق نفس الشكل.
 */
export interface MailSender {
  /**
   * بيبعت رسالة واحدة. ما بيرميش لخطأ مزود أو شبكة — بيرجع `{ sent: false, error }` عشان الـ
   * dispatcher يحسب المحاولة الجاية.
   *
   * @param message الرسالة ومفتاح الـ idempotency
   * @returns اتبعتت ولا لأ، بمين، وكود الخطأ لو لأ
   */
  send(message: MailMessage): Promise<MailResult>;
}
