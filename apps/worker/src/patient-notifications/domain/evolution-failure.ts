import type { WhatsappResult } from "../ports/whatsapp-sender.ts";

/**
 * أكواد فشل Evolution اللي مابتتعادش: إعادة المحاولة مش هتصلّحها (رقم مش على واتساب، رفض، مفتاح غلط،
 * التليفون مفصول)، أو ممكن تبعت الرسالة مرتين (`evo_timeout`، لأن Evolution مالوش مفتاح idempotency).
 */
const FINAL = new Set([
  "evo_not_on_whatsapp",
  "evo_timeout",
  "evo_rejected",
  "evo_unauthorized",
  "evo_not_connected",
  "evo_4xx",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// Evolution answers an error as { status, error, response: { message: [...] } }; the message can echo the
// number, so it is only inspected here for its shape and never copied anywhere.
function messages(body: unknown): unknown[] {
  if (!isRecord(body)) return [];
  const nested = isRecord(body["response"]) ? body["response"]["message"] : undefined;
  return [body["message"], nested].flatMap((value) => (Array.isArray(value) ? value : [value]));
}

/**
 * بيحوّل رد Evolution لنتيجة (Evolution v2.3.7): النجاح 2xx وفيه `key.id` (الرسالة اتسجّلت).
 * 2xx من غير `key` → `evo_rejected`. 401/403 → `evo_unauthorized` (مفتاح
 * غلط). 404 (الـ instance مش موجود) أو "Connection Closed" → `evo_not_connected`. 400 فيه
 * `exists: false` → `evo_not_on_whatsapp`. غير كده `evo_4xx` / `evo_5xx`.
 *
 * @param status حالة HTTP
 * @param body جسم الرد بعد `JSON.parse`، أو `null`
 * @returns اتبعت، أو كود قصير
 */
export function classifyEvolutionResponse(status: number, body: unknown): WhatsappResult {
  if (status >= 200 && status < 300) {
    const key = isRecord(body) ? body["key"] : undefined;
    return isRecord(key) &&
      typeof key["id"] === "string" &&
      key["id"] !== "" &&
      key["id"].length <= 200
      ? { sent: true, messageId: key["id"] }
      : { sent: false, error: "evo_rejected" };
  }
  if (status === 401 || status === 403) return { sent: false, error: "evo_unauthorized" };
  if (status === 404) return { sent: false, error: "evo_not_connected" };
  const parts = messages(body);
  if (parts.some((part) => isRecord(part) && part["exists"] === false)) {
    return { sent: false, error: "evo_not_on_whatsapp" };
  }
  if (parts.some((part) => typeof part === "string" && /connection closed/i.test(part))) {
    return { sent: false, error: "evo_not_connected" };
  }
  return { sent: false, error: status >= 500 ? "evo_5xx" : "evo_4xx" };
}

/**
 * فشل قبل أي رد: الـ 8 ثواني خلصت (`evo_timeout` — يمكن الرسالة وصلت، وإعادة المحاولة ممكن تكرّرها)، أو
 * الاتصال ماتمش (`evo_unreachable`).
 *
 * @param error اللي `fetch` رماه
 * @returns الكود
 */
export function classifyEvolutionError(error: unknown): string {
  const name =
    isRecord(error) || error instanceof Error ? (error as { name?: unknown }).name : null;
  return name === "TimeoutError" || name === "AbortError" ? "evo_timeout" : "evo_unreachable";
}

/**
 * هل الفشل نهائي (الصف يبقى `failed` من غير جدول المحاولات)؟
 *
 * @param error كود الفشل
 * @returns `true` لو مفيش محاولة هتصلّحه
 */
export function finalWhatsappError(error: string): boolean {
  return FINAL.has(error);
}
