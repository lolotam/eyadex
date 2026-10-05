import postgres from "postgres";

/**
 * Prefix of the advisory-lock key for two-factor enrollment. The key is
 * `hashtextextended(ENROLLMENT_LOCK_PREFIX || userId, 0)`, so any session on the database (a test, an
 * operator) can take the same lock.
 */
export const ENROLLMENT_LOCK_PREFIX = "eyadex:two-factor-enable:";

/** Connections dedicated to enrollment locks: enrollment is rare; more callers get `acquired: false`. */
export const ENROLLMENT_LOCK_CONNECTIONS = 3;

/** نتيجة محاولة القفل: يا إما اتنفّذ، يا إما في تسجيل تاني شغّال. */
export type LockedResult<T> =
  { readonly acquired: true; readonly value: T } | { readonly acquired: false };

/** قفل التسجيل بتاع منطقة واحدة، على pool لوحده. */
export interface EnrollmentLock {
  run<T>(userId: string, fn: () => Promise<T>): Promise<LockedResult<T>>;
  close(): Promise<void>;
}

/**
 * بيبني قفل التسجيل (ADR-0003 "One two-factor row per user") على pool **منفصل** عن pool بتاع Better
 * Auth: القفل بيحجز connection طول الـ handler، ولو من نفس الـ pool، كام مستخدم مختلف بيسجّلوا في نفس
 * اللحظة كانوا هياخدوا كل الـ connections والـ handler بتاعهم يستنى للأبد، وكل الدخول في المنطقة يقف.
 * هنا العدد محسوب في الذاكرة قبل الحجز: لو كله مشغول، الرد فوراً `acquired: false` من غير انتظار.
 *
 * @param databaseUrl رابط `eyadex_auth`
 * @param applicationName اسم الاتصال في `pg_stat_activity`
 * @returns القفل
 */
export function createEnrollmentLock(databaseUrl: string, applicationName: string): EnrollmentLock {
  const client = postgres(databaseUrl, {
    max: ENROLLMENT_LOCK_CONNECTIONS,
    fetch_types: false,
    onnotice: () => undefined,
    connection: { application_name: applicationName },
  });
  let active = 0;

  return {
    async run<T>(userId: string, fn: () => Promise<T>): Promise<LockedResult<T>> {
      // Counted before taking a connection: the pool never gets a waiter, so nothing queues forever.
      if (active >= ENROLLMENT_LOCK_CONNECTIONS) return { acquired: false };
      active += 1;
      try {
        const key = ENROLLMENT_LOCK_PREFIX + userId;
        // A transaction-scoped lock held by an open transaction on this pool: it is released by the
        // commit or the rollback, so no path can leak it. Not `reserve()`: postgres.js 3.4.9 never
        // resolves a reserve on a pool that has no open connection yet when fetch_types is false.
        let result: LockedResult<T> = { acquired: false };
        await client.begin(async (tx) => {
          const [row] = await tx<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`;
          if (row?.locked === true) result = { acquired: true, value: await fn() };
        });
        return result;
      } finally {
        active -= 1;
      }
    },
    close: () => client.end({ timeout: 5 }),
  };
}
