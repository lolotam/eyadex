import { createHmac } from "node:crypto";

import { deriveClinicKey, strictKey } from "./field-cipher.ts";

const INDEX_INFO = "eyadex-civil-id";

/**
 * فهرس أعمى للرقم المدني: HMAC بمفتاح الفهرس (منفصل ومابيتغيّرش مع تغيير مفاتيح التشفير، R1-7) مشتق لكل
 * عيادة، فالبحث بالرقم كامل يشتغل من غير ما الرقم يتخزّن مكشوف (P2-F5)، ونفس الرقم في عيادتين مالوش نفس
 * الفهرس.
 *
 * @param indexKey مفتاح الفهرس (32 بايت)
 * @param clinicId العيادة
 * @param digits الرقم المدني (12 رقم)
 * @returns الـ HMAC بالـ hex (64 حرف)
 */
export function civilIdHmac(indexKey: Buffer, clinicId: string, digits: string): string {
  return createHmac("sha256", deriveClinicKey(indexKey, clinicId, INDEX_INFO))
    .update(digits, "utf8")
    .digest("hex");
}

/**
 * بيقرا مفتاح الفهرس `MEDICAL_INDEX_KEY` من البيئة، ويفشل وقت التشغيل لو ناقص أو شكله غلط.
 *
 * @param env البيئة
 * @returns المفتاح (32 بايت)
 */
export function indexKeyFromEnv(env: Record<string, string | undefined>): Buffer {
  const raw = env["MEDICAL_INDEX_KEY"];
  if (raw === undefined || raw === "") throw new TypeError("MEDICAL_INDEX_KEY is missing");
  return strictKey("MEDICAL_INDEX_KEY", raw);
}
