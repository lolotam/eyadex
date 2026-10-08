import { sql, type Database } from "@eyadex/db";

import type { MailMessage, MailResult, MailSender } from "../invitation-mail/ports/mail-sender.ts";

/**
 * اسم المرسل من إعدادات المنصة (story 26، 0036) على pool الـ `eyadex_app` (SELECT بس).
 *
 * @param db الـ pool
 * @returns دالة بتقرا الاسم الحالي
 */
export function platformSenderName(db: Database): () => Promise<string> {
  return () =>
    db.withNoTenant(async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT email_sender_name FROM platform_settings WHERE id = 1`,
      )) as unknown as { email_sender_name: string }[];
      const name = rows[0]?.email_sender_name;
      if (name === undefined) throw new Error("platform_settings has no row");
      return name;
    });
}

/**
 * بريد المنصة باسم المرسل اللي فريق المنصة اختاره (ADR-0020): أي رسالة من غير `from` (المنصة بتبعت
 * باسمها) بتاخد الاسم على عنوان `MAIL_FROM`. الرسالة اللي ليها `from` (مزود العيادة أو الإرسال
 * بالنيابة عنها، ADR-0014) بتفضل زي ما هي. لو الاسم ماتقراش، الرسالة بتمشي بالمرسل المضبوط.
 */
export class NamedPlatformSender implements MailSender {
  readonly #inner: MailSender;
  readonly #address: string;
  readonly #name: () => Promise<string>;

  constructor(inner: MailSender, address: string, name: () => Promise<string>) {
    this.#inner = inner;
    this.#address = address;
    this.#name = name;
  }

  async send(message: MailMessage): Promise<MailResult> {
    if (message.from !== undefined) return this.#inner.send(message);
    let name: string | null = null;
    try {
      name = await this.#name();
    } catch {
      // A settings read that fails must not stop the mail: MAIL_FROM already names the platform.
    }
    return this.#inner.send(
      name === null ? message : { ...message, from: { name, address: this.#address } },
    );
  }
}
