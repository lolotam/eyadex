import { decideFallback } from "../../invitation-mail/domain/fallback-decision.ts";
import type { EmailRoute } from "./route-plan.ts";

// SMTP failures that happen before the DATA command is written: nothing of the message reached a server,
// so the next route cannot double it. The worker's SMTP transports report the stage (smtp-mail-sender.ts),
// and a failure once DATA was written carries `_after_data`, so it never matches here.
const SMTP_BEFORE_DATA = new Set([
  "smtp_dns",
  "smtp_edns",
  "smtp_blocked_address",
  "smtp_port_not_allowed",
  "smtp_econnrefused",
  "smtp_ehostunreach",
  "smtp_enetunreach",
  "smtp_econnection",
  "smtp_econnreset",
  "smtp_esocket",
  "smtp_etls",
  "smtp_auth",
  "smtp_enoauth",
  "smtp_eprotocol",
  "smtp_timeout",
]);

// Never reached a provider at all: the stored credentials could not be used.
const NEVER_SENT = new Set(["seal_unreadable", "invalid_provider"]);

const SMTP_REPLY = /^smtp_([1-5]\d\d)$/;

/**
 * هل الرسالة أكيد ما اتقبلتش، فنقدر ننقل للمسار اللي بعده من غير ما نخاطر إنها توصل مرتين (spec §3.3)؟
 * Resend: ما وصلش أو 5xx — قاعدة `decideFallback` نفسها. SMTP: DNS أو اتصال أو TLS أو مصادقة أو timeout
 * قبل ما أمر DATA يتكتب، أو رد 4xx/5xx من السيرفر (رد صريح بالرفض، حتى بعد الجسم). timeout أو اتصال
 * اتقطع بعد DATA (`_after_data`) أو أي كود مش معروف → لأ: نعيد نفس المسار.
 *
 * @param error كود الخطأ القصير من المرسل
 * @returns `true` لو ننقل للمسار اللي بعده
 */
export function certainlyNotAccepted(error: string): boolean {
  if (NEVER_SENT.has(error)) return true;
  if (error.startsWith("resend_")) return decideFallback(error) === "try_secondary";
  const reply = SMTP_REPLY.exec(error);
  if (reply !== null) return Number(reply[1]) >= 400;
  return SMTP_BEFORE_DATA.has(error);
}

const SEPARATOR = ":";
const ROUTES: readonly EmailRoute[] = ["primary", "fallback", "platform"];

/**
 * الكود اللي بيتكتب في `last_error` (الدفتر والـ outbox): المسار اللي المحاولة وقفت عنده + كود المرسل،
 * عشان المحاولة الجاية تعرف تكمّل منين. كود بس، عمره ما بيحمل عنوان أو نص.
 *
 * @param route المسار اللي وقفت عنده المحاولة
 * @param error كود المرسل
 * @param provider هوية المزود وإصداره عند الفشل الغامض، عشان الاستبدال مايكررّش الإرسال
 * @returns `<route>:<code>[:<id>:<version>]` بحد أقصى 120 حرف
 */
export function failureCode(
  route: EmailRoute,
  error: string,
  provider?: { readonly id: string; readonly version: number },
): string {
  const pin = provider === undefined ? "" : `:${provider.id}:${provider.version}`;
  return `${route}:${error.slice(0, 120 - route.length - 1 - pin.length)}${pin}`;
}

/**
 * من فين تبدأ المحاولة الجاية: لو آخر فشل كان غامض (يمكن الرسالة اتقبلت) نكمّل من نفس المسار، عمرنا ما
 * نرجع لمسار قبله (الرسالة يمكن تكون وصلت منه). لو كان أكيد أو مفيش فشل قبل كده → من الأول.
 *
 * @param lastError `last_error` على صف الدفتر، أو `null`
 * @returns المسار اللي نبدأ منه، أو `null` = من أول مسار
 */
export function resumeRoute(lastError: string | null): EmailRoute | null {
  if (lastError === null) return null;
  const cut = lastError.indexOf(SEPARATOR);
  if (cut < 0) return null;
  const route = lastError.slice(0, cut) as EmailRoute;
  if (!ROUTES.includes(route)) return null;
  return certainlyNotAccepted(lastError.slice(cut + 1).split(SEPARATOR)[0]!) ? null : route;
}

/**
 * هوية المزود للمحاولة الغامضة؛ الأكواد القديمة من غير هوية ماينفعش نخمّن مزودها.
 *
 * @param lastError آخر فشل محفوظ في الدفتر
 * @returns الهوية والإصدار، أو `null` لو مش محفوظين بشكل صالح
 */
export function resumeProvider(lastError: string | null): { id: string; version: number } | null {
  if (lastError === null) return null;
  const parts = lastError.split(SEPARATOR);
  const id = parts[2];
  const version = Number(parts[3]);
  if (
    parts.length !== 4 ||
    id === undefined ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ||
    !Number.isSafeInteger(version) ||
    version < 1
  )
    return null;
  return { id, version };
}
