import { ConfigurationError } from "@eyadex/observability";

/**
 * The Eyadex Meta app (spec §7.2, API only): the Embedded Signup configuration and the status webhook.
 * `appId` and `configId` are public; `appSecret` signs the webhook and exchanges signup codes;
 * `verifyToken` answers Meta's subscription check.
 */
export interface MetaAppConfig {
  readonly appId: string;
  readonly appSecret: string;
  readonly configId: string;
  readonly verifyToken: string;
}

const APP_ID = "META_APP_ID";
const APP_SECRET = "META_APP_SECRET";
const CONFIG_ID = "META_WHATSAPP_CONFIG_ID";
const VERIFY_TOKEN = "META_WEBHOOK_VERIFY_TOKEN";
const ALL = [APP_ID, APP_SECRET, CONFIG_ID, VERIFY_TOKEN] as const;

// The contract's shape for both public ids (whatsappSignupConfigSchema): checked at start, so the
// signup-config answer can never fail its own schema later.
const META_ID = /^\d{5,30}$/;

// Same wording as every other startup configuration error of the API: the variable, never its value.
const invalid = (name: string, reason: string): Error =>
  new ConfigurationError("API", [name], reason);

/**
 * يقرا إعداد تطبيق Meta من البيئة: الأربعة مع بعض أو ولا واحد. ولا واحد = الـ webhook و Embedded Signup
 * مقفولين (404)؛ ناقص واحد = الـ API مايقومش، والخطأ بيسمّي المتغيّر من غير قيمته.
 *
 * @param env بيئة العملية
 * @returns الإعداد، أو `null` لو مش متظبط خالص
 */
export function metaConfigFromEnv(env: NodeJS.ProcessEnv): MetaAppConfig | null {
  const value = (name: (typeof ALL)[number]) => env[name] ?? "";
  if (ALL.every((name) => value(name) === "")) return null;
  const missing = ALL.find((name) => value(name) === "");
  if (missing !== undefined) throw invalid(missing, `must be set with the other META_ variables`);
  if (!META_ID.test(value(APP_ID))) throw invalid(APP_ID, "must be 5 to 30 digits");
  if (!META_ID.test(value(CONFIG_ID))) throw invalid(CONFIG_ID, "must be 5 to 30 digits");
  if (value(VERIFY_TOKEN).length < 32)
    throw invalid(VERIFY_TOKEN, "must have at least 32 characters");
  return {
    appId: value(APP_ID),
    appSecret: value(APP_SECRET),
    configId: value(CONFIG_ID),
    verifyToken: value(VERIFY_TOKEN),
  };
}
