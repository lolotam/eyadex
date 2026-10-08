import postgres from "postgres";

import { createAuth } from "./create-auth.ts";
import { assertPassword, type CreateAuthOptions } from "./options.ts";

/** بيانات أول حساب منصة على داتابيز جديدة. كلمة المرور جاية من stdin، أبداً من الـ args. */
export interface FirstPlatformAccount {
  readonly email: string;
  readonly name: string;
  readonly password: string;
}

/** النتيجة: اتعمل الحساب، أو اترفض بسبب معروف (مفيش حاجة اتكتبت). */
export type FirstPlatformAccountResult =
  | { readonly created: true; readonly userId: string }
  | { readonly created: false; readonly reason: "platform_account_exists" | "email_taken" };

// Two bootstraps at once must not both see an empty platform: one waits for the other's commit.
const BOOTSTRAP_LOCK = "eyadex:first-platform-account";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;
const MAX_NAME = 120;

/**
 * بيطبّع الحساب ويرفضه قبل أي اتصال لو الإيميل أو الاسم أو كلمة المرور برا الحدود.
 *
 * @param account الحساب الخام
 * @returns الحساب بإيميل lowercase واسم من غير مسافات على الأطراف
 */
function normalizedAccount(account: FirstPlatformAccount): FirstPlatformAccount {
  assertPassword(account.password);
  const email = account.email.trim().toLowerCase();
  if (email.length > MAX_EMAIL || !EMAIL.test(email)) throw new TypeError("email is not valid");
  const name = account.name.trim();
  if (name === "" || name.length > MAX_NAME) {
    throw new TypeError(`name must be 1–${MAX_NAME} characters`);
  }
  return { email, name, password: account.password };
}

/**
 * بينشئ أول حساب منصة على داتابيز فاضية (ADR-0021) — مرة واحدة بس: لو فيه أي حساب منصة، أو الإيميل
 * محجوز لأي حد، بيرفض ومابيكتبش حاجة. الحجز (0015) بيفضل جوه transaction مفتوحة لحد ما Better Auth
 * يكتب المستخدم، فلو الإنشاء فشل الحجز بيترجع والتشغيل التاني يقدر يكمل. أول دخول بيطلب تسجيل TOTP.
 *
 * @param options خيارات `createAuth` من غير المنطقة (دايماً `platform`)
 * @param account الإيميل والاسم وكلمة المرور
 * @returns الحساب الجديد، أو سبب الرفض
 */
export async function createFirstPlatformAccount(
  options: Omit<CreateAuthOptions, "area" | "basePath" | "maxConnections">,
  account: FirstPlatformAccount,
): Promise<FirstPlatformAccountResult> {
  const { email, name, password } = normalizedAccount(account);
  // Validates the options (eyadex_auth only, the secret, the cookie prefix) before any connection.
  const auth = createAuth({ ...options, area: "platform", maxConnections: 1 });
  const client = postgres(options.databaseUrl, {
    max: 1,
    fetch_types: false,
    onnotice: () => undefined,
    connection: { application_name: "eyadex_auth:first-platform-account" },
  });
  try {
    return await client.begin(async (tx): Promise<FirstPlatformAccountResult> => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${BOOTSTRAP_LOCK}, 0))`;
      const existing = await tx`SELECT 1 FROM auth_users WHERE area = 'platform' LIMIT 1`;
      if (existing.length > 0) return { created: false, reason: "platform_account_exists" };
      const taken = await tx`SELECT 1 FROM auth_users WHERE email = ${email}`;
      if (taken.length > 0) return { created: false, reason: "email_taken" };
      const [hold] = await tx<{ held: boolean }[]>`SELECT reserve_platform_email(${email}) AS held`;
      if (hold?.held !== true) return { created: false, reason: "email_taken" };
      const { userId } = await auth.createUserAccount({ email, name, password });
      return { created: true, userId };
    });
  } finally {
    await Promise.all([client.end({ timeout: 5 }), auth.close()]);
  }
}
