import type { MessageLanguage } from "@eyadex/contracts/notifications";

import { escapeHtml } from "../../invitation-mail/domain/invitation-email.ts";

/** إيميل جاهز: موضوع سطر واحد، HTML متعمل له escape، ونص عادي. */
export interface RenderedNotification {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** سطر "عنوان: قيمة" في جسم الرسالة. القيمة نص خام؛ الـ escape هنا. */
export interface DetailLine {
  readonly label: string;
  readonly value: string;
}

// Latin digits in Arabic, like the rest of the app and the invitation email (formatExpiry).
const locale = (language: MessageLanguage) => (language === "ar" ? "ar-KW-u-nu-latn" : "en-GB");

/**
 * تاريخ ووقت الموعد بمنطقة العيادة ولغة الرسالة.
 *
 * @param at بداية الموعد
 * @param language لغة الرسالة
 * @param timeZone منطقة العيادة (IANA)
 * @returns التاريخ (باسم اليوم) والوقت، كل واحد لوحده
 */
export function formatWhen(
  at: Date,
  language: MessageLanguage,
  timeZone: string,
): { date: string; time: string } {
  return {
    date: new Intl.DateTimeFormat(locale(language), { dateStyle: "full", timeZone }).format(at),
    time: new Intl.DateTimeFormat(locale(language), { timeStyle: "short", timeZone }).format(at),
  };
}

/**
 * سطر واحد للموضوع: مفيش سطر جديد (حقن هيدر)، ومسافات متجمّعة.
 *
 * @param subject الموضوع
 * @returns موضوع آمن للهيدر
 */
export function oneLine(subject: string): string {
  return subject
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** محتوى رسالة قبل الإطار: كل النصوص خام، والإطار بيعمل لها escape. */
export interface NotificationBody {
  readonly language: MessageLanguage;
  readonly clinicName: string;
  readonly subject: string;
  readonly greeting: string;
  readonly intro: string;
  readonly details: readonly DetailLine[];
  /** قايمة تانية (أدوية الوصفة)، كل عنصر سطر. */
  readonly items?: readonly string[];
  /** رابط واحد تحت التفاصيل (الفاتورة)؛ الرابط نفسه بيتعمل له escape زي أي نص. */
  readonly action?: { readonly label: string; readonly url: string };
  readonly closing: string;
  readonly footer: string;
}

/**
 * الإطار المشترك: HTML بسيط من غير صور ولا تتبّع (spec §4)، `dir="rtl"` للعربي، وكل نص دخل من العيادة
 * أو المراجع متعمل له escape. النص العادي نفس المحتوى سطر بسطر.
 *
 * @param body المحتوى
 * @returns الموضوع والـ HTML والنص
 */
export function renderNotification(body: NotificationBody): RenderedNotification {
  const dir = body.language === "ar" ? "rtl" : "ltr";
  const e = escapeHtml;
  const rows = body.details
    .map(
      (d) =>
        `<tr><td style="padding:4px 0;color:#52606d;white-space:nowrap;vertical-align:top;">${e(d.label)}</td>` +
        `<td style="padding:4px 12px;">${e(d.value)}</td></tr>`,
    )
    .join("\n");
  const items =
    body.items === undefined || body.items.length === 0
      ? ""
      : `<ul style="padding-inline-start:20px;">\n${body.items.map((i) => `<li style="margin:4px 0;">${e(i)}</li>`).join("\n")}\n</ul>\n`;
  const action =
    body.action === undefined
      ? ""
      : `<p><a href="${e(body.action.url)}" style="color:#0b6e4f;font-weight:600;">${e(body.action.label)}</a></p>\n`;
  const html = `<!doctype html>
<html lang="${body.language}" dir="${dir}">
<body style="margin:0;padding:24px;background:#f7f6f3;font-family:'IBM Plex Sans Arabic','IBM Plex Sans',Arial,sans-serif;color:#1f2933;">
<div dir="${dir}" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e6ea;border-radius:8px;padding:24px;text-align:start;">
<p style="margin:0 0 16px;font-weight:600;">${e(body.clinicName)}</p>
<p>${e(body.greeting)}</p>
<p>${e(body.intro)}</p>
${rows === "" ? "" : `<table role="presentation" style="border-collapse:collapse;margin:16px 0;">\n${rows}\n</table>\n`}${items}${action}<p>${e(body.closing)}</p>
<p style="color:#52606d;font-size:13px;">${e(body.footer)}</p>
</div>
</body>
</html>`;
  const text = [
    body.greeting,
    "",
    body.intro,
    "",
    ...body.details.map((d) => `${d.label}: ${d.value}`),
    ...(body.items ?? []).map((i) => `- ${i}`),
    ...(body.action === undefined ? [] : ["", `${body.action.label}: ${body.action.url}`]),
    "",
    body.closing,
    "",
    body.footer,
  ].join("\n");
  return { subject: oneLine(body.subject), html, text };
}
