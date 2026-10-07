import { createHmac } from "node:crypto";

import type { MailProviderRequest, MailProviderView } from "@eyadex/contracts/mail-provider";

/** صف مزود العيادة كما هو في الداتابيز، من غير الختم. */
export interface MailProviderRecord {
  readonly id: string;
  readonly kind: "resend" | "smtp";
  readonly fromName: string;
  readonly fromEmail: string;
  readonly replyTo: string | null;
  readonly smtpHost: string | null;
  readonly smtpPort: number | null;
  readonly smtpUser: string | null;
  readonly verifiedAt: Date | null;
  readonly lastError: string | null;
  readonly degradedAt: Date | null;
  /** بيزيد مع كل استبدال؛ حدث التجربة بيحمله عشان الـ worker يعرف لو الإعدادات اتغيّرت. */
  readonly version: number;
  /** آخر طلب تجربة اتقبل، أو `null`. */
  readonly testRequestedAt: Date | null;
}

/** الحقول غير السرية من الطلب، والسر لوحده عشان يتختم. */
export interface SplitRequest {
  readonly fields: Pick<
    MailProviderRecord,
    "kind" | "fromName" | "fromEmail" | "replyTo" | "smtpHost" | "smtpPort" | "smtpUser"
  >;
  readonly secret: string;
}

/**
 * بيفصل السر (مفتاح Resend أو كلمة سر SMTP) عن باقي الحقول، عشان مايتخزنش ولا يرجع غير مختوم.
 *
 * @param request جسم `PUT`
 * @returns الحقول والسر
 */
export function splitRequest(request: MailProviderRequest): SplitRequest {
  const common = {
    fromName: request.fromName,
    fromEmail: request.fromEmail,
    replyTo: request.replyTo ?? null,
  };
  if (request.kind === "resend") {
    return {
      fields: { kind: "resend", ...common, smtpHost: null, smtpPort: null, smtpUser: null },
      secret: request.apiKey,
    };
  }
  return {
    fields: {
      kind: "smtp",
      ...common,
      smtpHost: request.host,
      smtpPort: request.port,
      smtpUser: request.user,
    },
    secret: request.password,
  };
}

/**
 * العرض اللي بيرجع للأدمن وبيتكتب في السجل: عمره ما فيه المفتاح ولا كلمة السر.
 *
 * @param record الصف
 * @returns العرض (`hasCredentials` دايماً `true` لأن الصف مايتعملش من غير سر)
 */
export function mailProviderView(record: MailProviderRecord): MailProviderView {
  return {
    kind: record.kind,
    fromName: record.fromName,
    fromEmail: record.fromEmail,
    replyTo: record.replyTo,
    smtpHost: record.smtpHost,
    smtpPort: record.smtpPort,
    smtpUser: record.smtpUser,
    hasCredentials: true,
    verifiedAt: record.verifiedAt?.toISOString() ?? null,
    lastError: record.lastError,
    degradedAt: record.degradedAt?.toISOString() ?? null,
  };
}

/**
 * بصمة جسم `PUT` لمفتاح الـ idempotency. الجسم فيه سر، فـ SHA-256 عادي كان هيخلّي جدول المفاتيح
 * وسيلة تخمين أوفلاين للمفتاح؛ HMAC بمفتاح الختم مايتحسبش من غير المفتاح.
 *
 * @param request الجسم بعد التحقق
 * @param base64Key `MAIL_PROVIDER_SEAL_KEY`
 * @returns hex بطول 64
 */
export function keyedRequestHash(request: MailProviderRequest, base64Key: string): string {
  const entries = Object.entries(request).sort(([a], [b]) => (a < b ? -1 : 1));
  return createHmac("sha256", Buffer.from(base64Key, "base64"))
    .update("mail-provider-put:" + JSON.stringify(entries))
    .digest("hex");
}

/** تجربة واحدة لكل عيادة في الدقيقة: إرسال SMTP بياخد لحد 5 ثواني من الـ poller الوحيد. */
export const TEST_COOLDOWN_MS = 60_000;

/**
 * فاضل قد إيه قبل ما العيادة تقدر تطلب تجربة تانية.
 *
 * @param lastRequestedAt آخر طلب اتقبل، أو `null`
 * @param now وقت القرار (بعد قفل الصف)
 * @returns الثواني الباقية (مقرّبة لفوق)، أو `0` لو مسموح
 */
export function testCooldownSeconds(lastRequestedAt: Date | null, now: Date): number {
  if (lastRequestedAt === null) return 0;
  const left = lastRequestedAt.getTime() + TEST_COOLDOWN_MS - now.getTime();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}
