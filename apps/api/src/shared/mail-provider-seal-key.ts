import { ConfigurationError } from "@eyadex/observability";

/**
 * بيقرا `MAIL_PROVIDER_SEAL_KEY` ويوقف التشغيل لو ناقص أو مش 32 بايت. الخطأ بيسمّي المفتاح بس. نفس
 * المفتاح بيختم بيانات مزود بريد العيادة (ADR-0014) وتوكن WhatsApp coexistence (spec §7.1)، كل واحد
 * مربوط بـ id صفّه.
 *
 * @param env البيئة
 * @returns المفتاح base64
 */
export function mailProviderSealKey(env: NodeJS.ProcessEnv): string {
  const value = env["MAIL_PROVIDER_SEAL_KEY"] ?? "";
  if (Buffer.from(value, "base64").length !== 32) {
    throw new ConfigurationError("API", ["MAIL_PROVIDER_SEAL_KEY"]);
  }
  return value;
}
