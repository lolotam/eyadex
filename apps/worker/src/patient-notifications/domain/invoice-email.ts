import type { MessageLanguage } from "@eyadex/contracts/notifications";

import { renderNotification, type RenderedNotification } from "./email-layout.ts";

/**
 * اللي رسالة الفاتورة بتقوله، ومفيش غيره (spec §8 rule 16): العيادة ورقم الفاتورة وإجماليها والرابط
 * الخاص. مفيش سطور ولا خدمات: الفاتورة نفسها ورا الرابط.
 */
export interface InvoiceMessage {
  readonly language: MessageLanguage;
  readonly clinicName: string;
  readonly number: string;
  /** الإجمالي مكتوب بخانات العملة وكودها، زي `12.500 KWD`. */
  readonly amount: string;
  readonly url: string;
}

const COPY = {
  ar: {
    subject: (c: string, n: string) => `فاتورتك من ${c} رقم ${n}`,
    greeting: "مرحباً،",
    intro: (c: string) => `أرسلت لك ${c} فاتورتك.`,
    number: "رقم الفاتورة",
    total: "الإجمالي",
    action: "عرض الفاتورة",
    closing: "الرابط خاص بك وصالح لمدة 14 يوماً. لأي استفسار، يرجى التواصل مع العيادة.",
    footer: (c: string) => `أُرسلت هذه الرسالة من ${c} عبر Eyadex.`,
  },
  en: {
    subject: (c: string, n: string) => `Your invoice ${n} from ${c}`,
    greeting: "Hello,",
    intro: (c: string) => `${c} has sent you your invoice.`,
    number: "Invoice number",
    total: "Total",
    action: "View the invoice",
    closing:
      "This link is private to you and works for 14 days. For any question, please contact the clinic.",
    footer: (c: string) => `This message was sent by ${c} through Eyadex.`,
  },
} as const;

/**
 * رسالة الفاتورة بلغة المراجع (أو لغة العيادة الافتراضية).
 *
 * @param message بيانات الفاتورة المسموح بيها بس
 * @returns الموضوع والـ HTML والنص
 */
export function renderInvoiceEmail(message: InvoiceMessage): RenderedNotification {
  const copy = COPY[message.language];
  return renderNotification({
    language: message.language,
    clinicName: message.clinicName,
    subject: copy.subject(message.clinicName, message.number),
    greeting: copy.greeting,
    intro: copy.intro(message.clinicName),
    details: [
      { label: copy.number, value: message.number },
      { label: copy.total, value: message.amount },
    ],
    action: { label: copy.action, url: message.url },
    closing: copy.closing,
    footer: copy.footer(message.clinicName),
  });
}
