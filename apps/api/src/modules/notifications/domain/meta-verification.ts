/**
 * أخطاء Meta التي تعني رفض بيانات الاعتماد، دون نسخ رسالة المزود.
 * @param status حالة HTTP
 * @param body الرد الخارجي
 * @returns هل البيانات مرفوضة
 */
export function metaCredentialsInvalid(status: number, body: unknown): boolean {
  const error =
    typeof body === "object" && body !== null
      ? (body as { error?: { code?: unknown } }).error
      : undefined;
  return [400, 401, 403, 190].includes(status) || error?.code === 190;
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
