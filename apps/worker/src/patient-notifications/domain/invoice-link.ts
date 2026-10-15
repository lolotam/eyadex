import { createHash } from "node:crypto";

/** عمر رابط الفاتورة (spec §8 rule 16): 14 يوم من وقت ما اتعمل. */
export const INVOICE_LINK_TTL_MS = 14 * 86_400_000;

/**
 * سياق ختم الرمز (C1، GCM additional data): ختم اتنسخ لصف رابط تاني أو رسالة تانية عمره ما بيتفتح.
 *
 * @param clinicId العيادة
 * @param linkId صف الرابط
 * @param notificationId صف الرسالة
 * @returns السياق
 */
export const invoiceLinkContext = (
  clinicId: string,
  linkId: string,
  notificationId: string,
): string => `invoice_link:${clinicId}:${linkId}:${notificationId}`;

/**
 * الـ hash اللي بيتخزن ويتدوّر بيه (0062 `token_hash`): SHA-256 للـ 32 byte العشوائيين، مش للنص.
 *
 * @param token الرمز بـ base64url
 * @returns الـ 32 byte
 */
export const invoiceTokenHash = (token: string): Buffer =>
  createHash("sha256").update(Buffer.from(token, "base64url")).digest();

/**
 * الرابط اللي في الرسالة: مسار الـ API العام على دومين العيادات، اللي بيرجّع آخر نسخة من الفاتورة PDF.
 *
 * @param appUrl أصل منطقة العيادات (`APP_URL`، من غير `/` في الآخر)
 * @param token الرمز بـ base64url
 * @returns الرابط
 */
export const invoiceLinkUrl = (appUrl: string, token: string): string =>
  `${appUrl}/api/v1/public/invoices/${token}`;

// C1-Q4: only a failure that proves the message never reached the patient revokes the link; a timeout may
// have delivered it, so its link stays live until it expires.
const NON_DELIVERY = new Set(["evo_not_on_whatsapp", "meta_not_on_whatsapp"]);

/**
 * فشل إرسال نهائي بيثبت إن الرسالة ماوصلتش؟ (C1-Q4)
 *
 * @param error كود فشل المزود
 * @returns صح لو الرابط يتقفل
 */
export const revokesInvoiceLink = (error: string): boolean => NON_DELIVERY.has(error);
