import type { TranslationKey } from "@/shared/i18n/dictionary";

const ERROR_KEYS = new Map<string, TranslationKey>([
  ["evo_connection_closed", "whatsapp.lastErrors.connectionClosed"],
  ["evo_not_connected", "whatsapp.lastErrors.notConnected"],
  ["evo_unauthorized", "whatsapp.lastErrors.evolutionKeyRefused"],
  ["meta_unauthorized", "whatsapp.lastErrors.metaCredentialsRefused"],
  ["meta_credentials_invalid", "whatsapp.lastErrors.metaCredentialsRefused"],
  ["meta_rate_limited", "whatsapp.lastErrors.metaRateLimit"],
  ["evo_timeout", "whatsapp.lastErrors.unconfirmed"],
  ["meta_timeout", "whatsapp.lastErrors.unconfirmed"],
  ["evo_unreachable", "whatsapp.lastErrors.unreachable"],
  ["meta_unreachable", "whatsapp.lastErrors.unreachable"],
]);

/**
 * يحوّل رمز الخطأ الداخلي إلى مفتاح رسالة آمنة للعرض، مع رسالة عامة للرموز غير المعروفة.
 * @param code رمز آخر محاولة
 * @returns مفتاح الترجمة دون كشف الرمز
 */
export function whatsappErrorKey(code: string): TranslationKey {
  return ERROR_KEYS.get(code) ?? "whatsapp.lastError";
}
