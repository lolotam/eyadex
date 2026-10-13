import type { WhatsappResult } from "../ports/whatsapp-sender.ts";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
const RETRY = new Set(["meta_rate_limited", "meta_5xx", "meta_unreachable"]);

/**
 * يصنّف رد Meta باستخدام الحالة والكود الرقمي فقط؛ نص الخطأ لا يغادر هذه الحدود.
 * @param status حالة HTTP
 * @param body الرد الخارجي
 * @returns معرّف الرسالة أو كود الفشل
 */
export function classifyMetaResponse(status: number, body: unknown): WhatsappResult {
  const error = record(record(body)["error"]);
  const code = error["code"];
  if (
    status === 401 ||
    code === 190 ||
    code === 10 ||
    (typeof code === "number" && code >= 200 && code <= 299)
  )
    return { sent: false, error: "meta_unauthorized" };
  if (
    typeof code === "number" &&
    ((code >= 132000 && code <= 132015) || code === 132068 || code === 132069)
  )
    return { sent: false, error: "meta_template" };
  if (code === 131026) return { sent: false, error: "meta_not_on_whatsapp" };
  if ([4, 80007, 130429, 131048, 131056].includes(code as number))
    return { sent: false, error: "meta_rate_limited" };
  if (status >= 500) return { sent: false, error: "meta_5xx" };
  if (status >= 200 && status < 300 && Object.keys(error).length === 0) {
    const messages = record(body)["messages"];
    const id = Array.isArray(messages) ? record(messages[0])["id"] : undefined;
    if (typeof id === "string" && id.length > 0 && id.length <= 200)
      return { sent: true, messageId: id };
  }
  return { sent: false, error: "meta_rejected" };
}

/**
 * فشل الشبكة يتحول إلى كود فقط؛ انتهاء المهلة نهائي لتجنّب تكرار رسالة ربما قُبلت.
 * @param error خطأ fetch
 * @returns كود آمن
 */
export function classifyMetaError(error: unknown): string {
  const name = record(error)["name"];
  return name === "TimeoutError" || name === "AbortError" ? "meta_timeout" : "meta_unreachable";
}

/**
 * يحدد أخطاء Meta النهائية.
 * @param error كود الفشل
 * @returns هل تتوقف المحاولات
 */
export function finalMetaError(error: string): boolean {
  return !RETRY.has(error);
}
