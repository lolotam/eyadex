import type { InvitationEvent } from "./invitation-event.ts";

/** نص الإيميل الجاهز. كل قيمة دخلت من المستخدم اتعمل لها escape في الـ HTML. */
export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * بيعمل escape لأي نص قبل ما يدخل HTML (الاسم واسم العيادة والدور كلهم إدخال مستخدم).
 *
 * @param value النص
 * @returns نص آمن جوه عنصر أو attribute
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

const COPY = {
  ar: {
    subject: (clinic: string) => `دعوة للانضمام إلى ${clinic} على Eyadex`,
    greeting: (name: string) => `مرحباً ${name}،`,
    adminBody: (clinic: string) => `تمت دعوتك لإدارة ${clinic} على Eyadex.`,
    userBody: (clinic: string, role: string) =>
      `تمت دعوتك للانضمام إلى فريق ${clinic} على Eyadex بدور ${role}.`,
    action: "قبول الدعوة وتعيين كلمة المرور",
    expiry: (date: string) => `ينتهي هذا الرابط في ${date}.`,
    ignore: "إذا لم تكن تتوقع هذه الدعوة فتجاهل هذه الرسالة.",
    signature: "فريق Eyadex",
  },
  en: {
    subject: (clinic: string) => `You're invited to join ${clinic} on Eyadex`,
    greeting: (name: string) => `Hello ${name},`,
    adminBody: (clinic: string) => `You have been invited to manage ${clinic} on Eyadex.`,
    userBody: (clinic: string, role: string) =>
      `You have been invited to join the ${clinic} team on Eyadex as ${role}.`,
    action: "Accept the invitation and set your password",
    expiry: (date: string) => `This link expires on ${date}.`,
    ignore: "If you were not expecting this invitation, you can ignore this email.",
    signature: "The Eyadex Team",
  },
} as const;

/**
 * بيكتب تاريخ الانتهاء بلغة العيادة ووقتها. أرقام لاتينية في العربي عشان تتقري زي باقي التطبيق.
 *
 * @param expiresAt وقت الانتهاء
 * @param language لغة الإيميل
 * @param timezone منطقة العيادة
 * @returns التاريخ مكتوب
 */
export function formatExpiry(expiresAt: Date, language: "ar" | "en", timezone: string): string {
  const locale = language === "ar" ? "ar-KW-u-nu-latn" : "en-GB";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: timezone,
  }).format(expiresAt);
}

/**
 * إيميل الدعوة بالعربي (RTL) أو الإنجليزي حسب لغة الحدث. البراند `Eyadex` بالحروف اللاتينية.
 *
 * @param event الحدث بعد التحقق
 * @param link رابط القبول الكامل
 * @param expiry تاريخ الانتهاء مكتوب (`formatExpiry`)
 * @returns الموضوع والـ HTML والنص
 */
export function renderInvitationEmail(
  event: InvitationEvent,
  link: string,
  expiry: string,
): RenderedEmail {
  const lang = event.language;
  const copy = COPY[lang];
  const clinic = event.clinicName[lang];
  const body =
    event.role === null ? copy.adminBody(clinic) : copy.userBody(clinic, event.role[lang]);
  const escapedBody =
    event.role === null
      ? copy.adminBody(escapeHtml(clinic))
      : copy.userBody(escapeHtml(clinic), escapeHtml(event.role[lang]));
  const dir = lang === "ar" ? "rtl" : "ltr";
  const html = `<!doctype html>
<html lang="${lang}" dir="${dir}">
<body style="margin:0;padding:24px;background:#f7f6f3;font-family:'IBM Plex Sans Arabic','IBM Plex Sans',Arial,sans-serif;color:#1f2933;">
<div dir="${dir}" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e6ea;border-radius:8px;padding:24px;text-align:start;">
<p style="margin:0 0 16px;font-weight:600;">Eyadex</p>
<p>${copy.greeting(escapeHtml(event.fullName))}</p>
<p>${escapedBody}</p>
<p style="margin:24px 0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#0f5e5c;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;">${copy.action}</a></p>
<p style="color:#52606d;">${escapeHtml(copy.expiry(expiry))}</p>
<p style="color:#52606d;">${copy.ignore}</p>
<p>${copy.signature}</p>
</div>
</body>
</html>`;
  const text = [
    copy.greeting(event.fullName),
    "",
    body,
    "",
    `${copy.action}: ${link}`,
    "",
    copy.expiry(expiry),
    copy.ignore,
    "",
    copy.signature,
  ].join("\n");
  return { subject: copy.subject(clinic), html, text };
}
