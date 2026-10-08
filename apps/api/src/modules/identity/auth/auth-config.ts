import { z } from "zod";

// Read only when the auth module is mounted. Values are never echoed: the error names the keys.
const schema = z.object({
  APP_URL: z.string().url(),
  PLATFORM_URL: z.string().url(),
  AUTH_DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  // The auth rate limiter (ADR-0005); without it the limited routes fail closed, so it is required here.
  REDIS_URL: z
    .string()
    .url()
    .refine((value) => /^rediss?:\/\//.test(value)),
  // 0 = the API is reached directly and Host is authoritative; N = exactly N reverse proxies in front.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  // ADR-0021: each environment names its cookies apart (`eyadex-staging` → eyadex-staging-clinic.*).
  // Unset keeps production's `eyadex-<area>`; @eyadex/auth checks the format before any pool opens.
  AUTH_COOKIE_PREFIX: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
});

export type AuthConfig = z.output<typeof schema>;

/**
 * بيقرا إعدادات الـ auth من الـ env. الخطأ بيسمّي المفاتيح بس ومابيطبعش قيمة.
 *
 * @param env الـ process environment
 * @returns الإعدادات بعد التحقق
 */
export function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid auth configuration: ${keys.join(", ")} — see .env.example`);
  }
  return result.data;
}
