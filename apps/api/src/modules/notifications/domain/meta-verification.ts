/** Meta's error when the WhatsApp Business app on the number has two-step verification on (N3). */
export const META_TWO_STEP_CODE = 2388001;

/**
 * كود خطأ Meta الرقمي بس، من غير نص المزود.
 * @param body الرد الخارجي
 * @returns الكود أو null
 */
export function metaErrorCode(body: unknown): number | null {
  const error =
    typeof body === "object" && body !== null
      ? (body as { error?: { code?: unknown } }).error
      : undefined;
  return typeof error?.code === "number" ? error.code : null;
}

/**
 * أخطاء Meta التي تعني رفض بيانات الاعتماد، دون نسخ رسالة المزود.
 * @param status حالة HTTP
 * @param body الرد الخارجي
 * @returns هل البيانات مرفوضة
 */
export function metaCredentialsInvalid(status: number, body: unknown): boolean {
  return [400, 401, 403, 190].includes(status) || metaErrorCode(body) === 190;
}

/**
 * هل Meta رفض الرقم لأن التحقق بخطوتين شغّال على تطبيق WhatsApp Business (الخطأ 2388001)؟ بيتفحص قبل
 * رفض بيانات الاعتماد، لأن Meta ممكن يرجّعه بحالة 400.
 * @param body الرد الخارجي
 * @returns هل التحقق بخطوتين هو السبب
 */
export function metaTwoStepEnabled(body: unknown): boolean {
  return metaErrorCode(body) === META_TWO_STEP_CODE;
}

/**
 * التوكن من رد `oauth/access_token`، لو شكله معقول بس.
 * @param body الرد الخارجي
 * @returns التوكن أو null
 */
export function metaAccessToken(body: unknown): string | null {
  const token =
    typeof body === "object" && body !== null
      ? (body as { access_token?: unknown }).access_token
      : undefined;
  return typeof token === "string" && token.length > 0 && token.length <= 4096 ? token : null;
}

/**
 * يستخرج آخر أربع خانات دون الاحتفاظ بالرقم الكامل.
 * @param body رد Graph للتحقق من الرقم
 * @returns الخانات أو null لرد غير صالح
 */
export function metaPhoneLast4(body: unknown): string | null {
  const phone =
    typeof body === "object" && body !== null
      ? (body as { display_phone_number?: unknown }).display_phone_number
      : null;
  if (typeof phone !== "string") return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}
