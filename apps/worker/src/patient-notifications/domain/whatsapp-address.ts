import { normalizeKuwaitPhone } from "@eyadex/contracts/patients";

/**
 * رقم المراجع زي ما واتساب بيستناه (spec §7.1): `+965` و8 أرقام → `965` و8 أرقام، من غير `+`.
 * أي شكل `normalizeKuwaitPhone` بيقبله (بـ `+965` أو `00965` أو 8 أرقام) بيوصل لنفس الرقم. الرقم ده عمره
 * ما بيتسجّل في سطر ولا في `last_error`.
 *
 * @param phone `patients.phone` كما هو محفوظ
 * @returns الرقم لواتساب، أو `null` لو مش رقم كويتي صالح
 */
export function whatsappNumber(phone: string): string | null {
  const normalized = normalizeKuwaitPhone(phone);
  return normalized === null ? null : normalized.slice(1);
}
