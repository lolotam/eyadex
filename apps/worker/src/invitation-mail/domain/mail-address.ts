import type { MailAddress } from "../ports/mail-sender.ts";

/**
 * بينضف الاسم الظاهر: مفيش سطر جديد (حقن هيدر) ولا مسافات زيادة، وبحد أقصى 100 حرف.
 *
 * @param name الاسم اللي العيادة كتبته
 * @returns اسم آمن للهيدر
 */
export function displayName(name: string): string {
  return name
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

/**
 * بيكتب المرسل بشكل `"الاسم" <العنوان>` لـ Resend، مع escape للعلامات جوه الاسم.
 *
 * @param from الاسم والعنوان
 * @returns قيمة هيدر `From`
 */
export function formatAddress(from: MailAddress): string {
  const name = displayName(from.name).replace(/["\\]/g, (c) => `\\${c}`);
  return name === "" ? from.address : `"${name}" <${from.address}>`;
}

/**
 * عنوان المنصة من `MAIL_FROM` (`Name <addr>` أو العنوان لوحده)، للإرسال بالنيابة عن عيادة متحوّلة.
 *
 * @param mailFrom قيمة `MAIL_FROM`
 * @returns العنوان بس
 */
export function addressOf(mailFrom: string): string {
  const match = /<([^<>]+)>\s*$/.exec(mailFrom);
  return (match?.[1] ?? mailFrom).trim();
}
