import { escapeHtml, type RenderedEmail } from "../../invitation-mail/domain/invitation-email.ts";

/** اللي الإيميل محتاجه: كله اتقرا وقت الإرسال. */
export interface ReminderContent {
  readonly language: "ar" | "en";
  readonly clinicName: string;
  readonly recipientName: string;
  readonly daysLeft: number;
  /** تاريخ الانتهاء مكتوب بلغة العيادة ومنطقتها (`formatExpiry`). */
  readonly expiresOn: string;
}

const COPY = {
  ar: {
    subject: (clinic: string) => `اشتراك ${clinic} على Eyadex ينتهي قريبًا`,
    greeting: (name: string) => `مرحباً ${name}،`,
    body: (clinic: string, days: number) =>
      days <= 1
        ? `ينتهي اشتراك ${clinic} على Eyadex خلال يوم واحد.`
        : `ينتهي اشتراك ${clinic} على Eyadex خلال ${days} أيام.`,
    date: (date: string) => `موعد الانتهاء: ${date}.`,
    action: "تواصل مع فريق Eyadex لتجديد الاشتراك قبل أن يتوقف الدخول إلى العيادة.",
    data: "بيانات عيادتك تبقى محفوظة كما هي.",
    signature: "فريق Eyadex",
  },
  en: {
    subject: (clinic: string) => `${clinic}'s Eyadex subscription ends soon`,
    greeting: (name: string) => `Hello ${name},`,
    body: (clinic: string, days: number) =>
      days <= 1
        ? `The Eyadex subscription of ${clinic} ends within a day.`
        : `The Eyadex subscription of ${clinic} ends in ${days} days.`,
    date: (date: string) => `It ends on ${date}.`,
    action: "Contact the Eyadex team to renew before access to the clinic stops.",
    data: "Your clinic's data stays exactly as it is.",
    signature: "The Eyadex Team",
  },
} as const;

/**
 * إيميل التنبيه قبل الانتهاء (story 79، ADR-0020) بلغة العيادة الافتراضية (story 82). اسم العيادة
 * واسم الأدمن إدخال مستخدم: escape في الـ HTML، ومن غير أسطر في الموضوع.
 *
 * @param content المحتوى
 * @returns الموضوع والـ HTML والنص
 */
export function renderReminderEmail(content: ReminderContent): RenderedEmail {
  const lang = content.language;
  const copy = COPY[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";
  const clinic = content.clinicName;
  const html = `<!doctype html>
<html lang="${lang}" dir="${dir}">
<body style="margin:0;padding:24px;background:#f7f6f3;font-family:'IBM Plex Sans Arabic','IBM Plex Sans',Arial,sans-serif;color:#1f2933;">
<div dir="${dir}" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e6ea;border-radius:8px;padding:24px;text-align:start;">
<p style="margin:0 0 16px;font-weight:600;">Eyadex</p>
<p>${copy.greeting(escapeHtml(content.recipientName))}</p>
<p>${copy.body(escapeHtml(clinic), content.daysLeft)}</p>
<p>${escapeHtml(copy.date(content.expiresOn))}</p>
<p>${copy.action}</p>
<p style="color:#52606d;">${copy.data}</p>
<p>${copy.signature}</p>
</div>
</body>
</html>`;
  const text = [
    copy.greeting(content.recipientName),
    "",
    copy.body(clinic, content.daysLeft),
    copy.date(content.expiresOn),
    "",
    copy.action,
    copy.data,
    "",
    copy.signature,
  ].join("\n");
  return { subject: copy.subject(clinic).replace(/[\r\n]+/g, " "), html, text };
}
