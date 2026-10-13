import { createHash, timingSafeEqual } from "node:crypto";

/**
 * يقارن بصمات بطول ثابت حتى لا تكشف المقارنة طول السر أو بادئته.
 * @param header قيمة هيدر webhook
 * @param secret السر المهيّأ
 * @returns هل الهيدر موثوق
 */
export function webhookAuthenticated(header: unknown, secret: string): boolean {
  const digest = (text: string) => createHash("sha256").update(text).digest();
  const matched = timingSafeEqual(digest(typeof header === "string" ? header : ""), digest(secret));
  return typeof header === "string" && matched;
}
