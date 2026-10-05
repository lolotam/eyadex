import {
  authAccounts,
  authSessions,
  authTwoFactors,
  authUsers,
  authVerifications,
} from "@eyadex/db/schema";
import type { IdGenerator } from "@eyadex/ids";
import { runWithTransaction } from "@better-auth/core/context";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins/two-factor";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { assertOptions, PASSWORD_LIMITS, type AuthArea } from "./options.ts";

export type { AuthArea } from "./options.ts";

/** خيارات الـ factory. كل قيمة سرية جاية من الـ env، ومفيش default ليها. */
export interface CreateAuthOptions {
  /** منطقة الجلسة: `platform` أو `clinic` — كل واحدة ليها اسم cookie مختلف. */
  readonly area: AuthArea;
  /** رابط الداتابيز على الدور `eyadex_auth` بس (PRD §4.5). */
  readonly databaseUrl: string;
  /** `BETTER_AUTH_SECRET`: بيوقّع الـ cookies وبيشفّر سر الـ TOTP. 32 حرف على الأقل. */
  readonly secret: string;
  /** الـ origin بتاع المنطقة (مثلاً `https://app.eyadex.com`). */
  readonly baseUrl: string;
  /** مولّد UUID v7 من `@eyadex/ids`. */
  readonly ids: IdGenerator;
  /** حجم الـ pool، افتراضياً 5. */
  readonly maxConnections?: number;
}

const schema = {
  user: authUsers,
  session: authSessions,
  account: authAccounts,
  verification: authVerifications,
  twoFactor: authTwoFactors,
};

/**
 * بيبني إعدادات Better Auth لمنطقة واحدة فوق client واحد.
 *
 * @param options خيارات الـ factory بعد التحقق
 * @param client الـ postgres.js pool على `eyadex_auth`
 * @returns instance بتاع Better Auth
 */
function buildAuth(options: CreateAuthOptions, client: postgres.Sql) {
  return betterAuth({
    appName: "Eyadex",
    baseURL: options.baseUrl,
    secret: options.secret,
    trustedOrigins: [options.baseUrl],
    // The adapter's default is `transaction: false`, which runs Better Auth's multi-row writes
    // (and runWithTransaction below) as separate statements.
    database: drizzleAdapter(drizzle(client), { provider: "pg", schema, transaction: true }),
    emailAndPassword: {
      enabled: true,
      // No self sign-up (PRD §4.10): accounts come only from createUserAccount.
      disableSignUp: true,
      minPasswordLength: PASSWORD_LIMITS.min,
      maxPasswordLength: PASSWORD_LIMITS.max,
    },
    // Sessions live only in PostgreSQL: no cookie cache, so a revoked session ends on the next request.
    session: { cookieCache: { enabled: false } },
    user: { deleteUser: { enabled: false } },
    // Recovery codes are a second factor: encrypted at rest with the secret, like the TOTP secret.
    // 1.7.7 already defaults to "encrypted"; stated here so an upgrade cannot silently go plain.
    plugins: [
      twoFactor({ issuer: "Eyadex", backupCodeOptions: { storeBackupCodes: "encrypted" } }),
    ],
    telemetry: { enabled: false },
    advanced: {
      // A distinct prefix per area: app. and platform. never share a session cookie (PRD §4.15).
      cookiePrefix: `eyadex-${options.area}`,
      useSecureCookies: options.baseUrl.startsWith("https://"),
      database: { generateId: () => options.ids.newId() },
    },
  });
}

/** نوع الـ instance اللي `createAuth` بيرجّعه في `auth`. */
export type AuthInstance = ReturnType<typeof buildAuth>;

/** بيانات حساب جديد بينشأ من السيرفر بس. */
export interface NewUserAccount {
  readonly email: string;
  readonly name: string;
  readonly password: string;
}

/** اللي `createAuth` بيرجّعه. */
export interface EyadexAuth {
  /** الـ instance نفسه (الـ handler والـ API بتاعه) — بيتربط على HTTP في slice 2b. */
  readonly auth: AuthInstance;
  /**
   * الطريقة الوحيدة لإنشاء مستخدم: التسجيل الذاتي مقفول. الـ hash بيعمله Better Auth نفسه.
   *
   * @param account الإيميل والاسم وكلمة المرور
   * @returns الـ id بتاع المستخدم الجديد
   */
  createUserAccount(account: NewUserAccount): Promise<{ userId: string }>;
  /**
   * بيلغي كل جلسات المستخدم فوراً (تعطيل المستخدم — PRD §4.10).
   *
   * @param userId الـ id بتاع المستخدم
   * @returns بيخلص لما الجلسات تتمسح
   */
  revokeUserSessions(userId: string): Promise<void>;
  /**
   * بيقفل الـ pool.
   *
   * @returns بيخلص لما الاتصالات تتقفل
   */
  close(): Promise<void>;
}

/**
 * بيبني Better Auth لمنطقة واحدة (`platform` أو `clinic`) على pool خاص بالدور `eyadex_auth`.
 * إيميل + كلمة مرور، التسجيل الذاتي مقفول، plugin الـ two-factor، والجلسات في PostgreSQL.
 * postgres.js كسلان: مفيش اتصال لحد أول طلب.
 *
 * @param options المنطقة والرابط والسر والـ origin ومولّد الـ ids
 * @returns الـ instance والـ helpers والـ `close`
 */
export function createAuth(options: CreateAuthOptions): EyadexAuth {
  assertOptions(options);
  const client = postgres(options.databaseUrl, {
    max: options.maxConnections ?? 5,
    fetch_types: false,
    onnotice: () => undefined,
    connection: { application_name: `eyadex_auth:${options.area}` },
  });
  const auth = buildAuth(options, client);

  return {
    auth,
    createUserAccount: async ({ email, name, password }) => {
      if (password.length < PASSWORD_LIMITS.min || password.length > PASSWORD_LIMITS.max) {
        throw new RangeError(
          `password must be ${PASSWORD_LIMITS.min}–${PASSWORD_LIMITS.max} characters`,
        );
      }
      const context = await auth.$context;
      const hash = await context.password.hash(password);
      // User and credential row commit together: a failed linkAccount must not leave a user that can
      // never sign in while holding the email. TODO(spec): the global email hold (0015) belongs to
      // the identity use case that calls this (invitation acceptance, slice 2b+).
      return runWithTransaction(context.adapter, async () => {
        const user = await context.internalAdapter.createUser(
          {
            email: email.trim().toLowerCase(),
            name,
            emailVerified: true,
          },
          { method: "admin" },
        );
        await context.internalAdapter.linkAccount({
          userId: user.id,
          providerId: "credential",
          accountId: user.id,
          password: hash,
        });
        return { userId: user.id };
      });
    },
    revokeUserSessions: async (userId) => {
      const context = await auth.$context;
      await context.internalAdapter.deleteUserSessions(userId);
    },
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}
