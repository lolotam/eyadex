import type postgres from "postgres";

/**
 * Prefix of the advisory-lock key for two-factor enrollment. The key is
 * `hashtextextended(ENROLLMENT_LOCK_PREFIX || userId, 0)`, so any session on the database (a test, an
 * operator) can take the same lock.
 */
export const ENROLLMENT_LOCK_PREFIX = "eyadex:two-factor-enable:";

/** نتيجة محاولة القفل: يا إما اتنفّذ، يا إما في تسجيل تاني شغّال لنفس المستخدم. */
export type LockedResult<T> =
  { readonly acquired: true; readonly value: T } | { readonly acquired: false };

/**
 * بيشغّل `fn` وهو ماسك advisory lock على المستخدم (ADR-0003 "One two-factor row per user"). لو القفل
 * مع طلب تاني بيرجع فوراً `acquired: false` من غير ما يستنى: الطلب التاني كان هيكتب سر جديد فوق سر
 * الأول، فالـ QR اللي الأول رجّعه ماكانش هيتحقق.
 *
 * @param client الـ pool على `eyadex_auth`
 * @param userId المستخدم اللي بيسجّل
 * @param fn الشغل اللي بيتعمل تحت القفل
 * @returns النتيجة، أو `acquired: false` لو القفل مشغول
 */
export async function withEnrollmentLock<T>(
  client: postgres.Sql,
  userId: string,
  fn: () => Promise<T>,
): Promise<LockedResult<T>> {
  const key = ENROLLMENT_LOCK_PREFIX + userId;
  // Session-level lock on ONE reserved connection: lock and unlock must run on the same backend, and the
  // handler's own queries use other pool connections.
  const connection = await client.reserve();
  try {
    const [row] = await connection<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS locked`;
    if (row?.locked !== true) return { acquired: false };
    try {
      return { acquired: true, value: await fn() };
    } finally {
      await connection`SELECT pg_advisory_unlock(hashtextextended(${key}, 0))`;
    }
  } finally {
    connection.release();
  }
}
