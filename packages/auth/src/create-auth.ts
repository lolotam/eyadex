import {
  authAccounts,
  authSessions,
  authTwoFactors,
  authUsers,
  authVerifications,
} from "@eyadex/db/schema";
import { runWithTransaction } from "@better-auth/core/context";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins/two-factor";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { CLIENT_IP_HEADER, sessionAreaHook } from "./area-binding.ts";
import { createEnrollmentLock, type LockedResult } from "./enrollment-lock.ts";
import {
  areaCookiePrefix,
  assertOptions,
  assertPassword,
  PASSWORD_LIMITS,
  type AuthArea,
  type CreateAuthOptions,
} from "./options.ts";

export type { AuthArea, CreateAuthOptions } from "./options.ts";

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
  // Parsed once: `HTTPS://Host` or surrounding spaces pass assertOptions, so every setting below
  // reads the normalized origin and protocol, never the raw spelling.
  const base = new URL(options.baseUrl);
  const db = drizzle(client);
  return betterAuth({
    appName: "Eyadex",
    baseURL: base.origin,
    basePath: options.basePath ?? "/api/auth",
    secret: options.secret,
    trustedOrigins: [base.origin],
    // The adapter's default is `transaction: false`, which runs Better Auth's multi-row writes
    // (and runWithTransaction below) as separate statements.
    database: drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
    // One account, one area (0024): no session is minted for a user of the other area, whatever the path.
    databaseHooks: { session: { create: { before: sessionAreaHook(db, options.area) } } },
    emailAndPassword: {
      enabled: true,
      // No self sign-up (PRD §4.10): accounts come only from createUserAccount.
      disableSignUp: true,
      minPasswordLength: PASSWORD_LIMITS.min,
      maxPasswordLength: PASSWORD_LIMITS.max,
    },
    // Sessions live only in PostgreSQL: no cookie cache, so a revoked session ends on the next request.
    // `area` records which area issued the session; getSession refuses one from the other area.
    session: {
      cookieCache: { enabled: false },
      additionalFields: {
        area: { type: "string", required: true, input: false, defaultValue: options.area },
        // Set by sessionAreaHook from the minting endpoint; never from the client (0024).
        twoFactorVerified: { type: "boolean", required: true, input: false, defaultValue: false },
      },
    },
    user: {
      deleteUser: { enabled: false },
      additionalFields: { area: { type: "string", required: true, input: false } },
    },
    // Recovery codes are a second factor: encrypted at rest with the secret, like the TOTP secret.
    // 1.7.7 already defaults to "encrypted"; stated here so an upgrade cannot silently go plain.
    plugins: [
      twoFactor({ issuer: "Eyadex", backupCodeOptions: { storeBackupCodes: "encrypted" } }),
    ],
    telemetry: { enabled: false },
    // Better Auth's own console logger writes outside the API's sanitising logger (CLAUDE.md §8): a line
    // can carry an email or a provider message. Its failures still reach apps/api as thrown errors or
    // non-2xx responses, which are logged there through the catalogue.
    logger: { disabled: true },
    // Off: Better Auth's limiter is in-memory per process, so N replicas would allow N times the limit.
    // apps/api counts every limited route in Redis before Better Auth is called (ADR-0005).
    rateLimit: { enabled: false },
    advanced: {
      // One prefix per area and per environment: app. and platform. never share a session cookie
      // (PRD §4.15), and neither do staging and production (ADR-0021).
      cookiePrefix: areaCookiePrefix(options.cookiePrefix, options.area),
      useSecureCookies: base.protocol === "https:",
      // Better Auth skips the Origin check when NODE_ENV is "test"; stated false so tests see production.
      disableOriginCheck: false,
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
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

/** جلسة صالحة في المنطقة اللي طلبتها. */
export type AreaSession = NonNullable<Awaited<ReturnType<AuthInstance["api"]["getSession"]>>>;

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
   * الحساب اللي شايل الإيميل ده في أي منطقة (الجدول واحد للمنطقتين). اللي بينادي بيقرر: حساب من
   * المنطقة التانية مابيتعادش استخدامه أبدًا (0024).
   *
   * @param email الإيميل
   * @returns الـ id والمنطقة، أو `null`
   */
  findAccountByEmail(email: string): Promise<{ userId: string; area: AuthArea } | null>;
  /**
   * كلمة مرور جديدة بـ hasher بتاع Better Auth، وبيلغي الجلسات (ADR-0008؛ مفيش حذف مستخدمين).
   *
   * @param userId المستخدم
   * @param password كلمة المرور الجديدة (`PASSWORD_LIMITS`)
   * @returns بيخلص لما تتحفظ
   */
  setAccountPassword(userId: string, password: string): Promise<void>;
  /**
   * بيلغي كل جلسات المستخدم فوراً (تعطيل المستخدم — PRD §4.10).
   *
   * @param userId الـ id بتاع المستخدم
   * @returns بيخلص لما الجلسات تتمسح
   */
  revokeUserSessions(userId: string): Promise<void>;
  /**
   * الجلسة الحالية لو صادرة من نفس المنطقة بس. المنطقتين بيشاركوا الجدول وسر التوقيع، فـ cookie
   * عيادة اتنسخت باسم cookie المنصة بتتوقّع صح — العمود `area` هو اللي بيفصل (PRD §4.15).
   * الـ guards في slice 2b لازم تستخدم دي، مش `auth.api.getSession` مباشرة.
   *
   * @param headers headers الطلب (فيها الـ cookie)
   * @returns الجلسة والمستخدم، أو `null` لو مفيش جلسة أو صادرة من المنطقة التانية
   */
  getSession(headers: Headers): Promise<AreaSession | null>;
  /**
   * هل الطلب شايل جلسة صالحة بس صادرة من المنطقة التانية؟ Better Auth لوحده بيقبلها (نفس الجدول
   * ونفس السر)، فكل route بيقرا جلسة لازم يرفضها قبل ما يوصل لـ Better Auth (ADR-0003).
   *
   * @param headers headers الطلب (فيها الـ cookie)
   * @returns `true` لو الجلسة موجودة ومن المنطقة التانية
   */
  isForeignSession(headers: Headers): Promise<boolean>;
  /**
   * بيشغّل تسجيل الـ two-factor تحت قفل لكل مستخدم (ADR-0003): طلبين متداخلين مايرجّعوش QR الاتنين.
   *
   * @param userId المستخدم
   * @param fn الـ handler
   * @returns النتيجة، أو `acquired: false` لو في تسجيل تاني شغّال
   */
  withEnrollmentLock<T>(userId: string, fn: () => Promise<T>): Promise<LockedResult<T>>;
  /**
   * بيلغي كل جلسات المستخدم ما عدا الجلسة اللي في الـ headers. بيتنده بعد ما مستخدم منصة يكمّل تسجيل
   * TOTP: الجلسات اللي اتعملت بكلمة المرور بس قبل التسجيل ماتبقاش جلسات كاملة الصلاحية.
   *
   * @param userId المستخدم
   * @param keep headers فيها cookie الجلسة اللي تفضل
   * @returns بيخلص لما الجلسات التانية تتمسح
   */
  revokeOtherSessions(userId: string, keep: Headers): Promise<void>;
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
  const lock = createEnrollmentLock(options.databaseUrl, `eyadex_auth:${options.area}:lock`);

  return {
    auth,
    createUserAccount: async ({ email, name, password }) => {
      assertPassword(password);
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
            // The instance's own area: a clinic instance creates clinic accounts only (0024).
            area: options.area,
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
    findAccountByEmail: async (email) => {
      const rows = await client<{ id: string; area: AuthArea }[]>`
        SELECT id, area FROM auth_users WHERE email = ${email.trim().toLowerCase()}`;
      const row = rows[0];
      return row === undefined ? null : { userId: row.id, area: row.area };
    },
    setAccountPassword: async (userId, password) => {
      assertPassword(password);
      const context = await auth.$context;
      const rows = await client<
        { area: AuthArea }[]
      >`SELECT area FROM auth_users WHERE id = ${userId}`;
      if (rows[0]?.area !== options.area) throw new Error("account is not in this area");
      await context.internalAdapter.updatePassword(userId, await context.password.hash(password));
      await context.internalAdapter.deleteUserSessions(userId);
    },
    getSession: async (headers) => {
      const found = await auth.api.getSession({ headers });
      return found !== null && found.session.area === options.area ? found : null;
    },
    isForeignSession: async (headers) => {
      const found = await auth.api.getSession({ headers });
      return found !== null && found.session.area !== options.area;
    },
    revokeUserSessions: async (userId) => {
      const context = await auth.$context;
      await context.internalAdapter.deleteUserSessions(userId);
    },
    withEnrollmentLock: (userId, fn) => lock.run(userId, fn),
    revokeOtherSessions: async (userId, keep) => {
      const kept = await auth.api.getSession({ headers: keep });
      const context = await auth.$context;
      for (const session of await context.internalAdapter.listSessions(userId)) {
        if (session.token !== kept?.session.token) {
          await context.internalAdapter.deleteSession(session.token);
        }
      }
    },
    close: async () => {
      await Promise.all([client.end({ timeout: 5 }), lock.close()]);
    },
  };
}
