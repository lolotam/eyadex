import type { PlatformAccountResponse } from "@eyadex/contracts/platform-console";
import type { Tx } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";

// The platform team table (0037, ADR-0020). Every function runs inside a transaction on the
// eyadex_platform pool; nothing here reads a clinic table.

export type PlatformAccountStatus = "invited" | "active" | "deactivated";

export interface PlatformAccountRow {
  id: string;
  user_id: string | null;
  email: string;
  full_name: string;
  status: PlatformAccountStatus;
  token_hash: string | null;
  token_expires_at: Date | string | null;
  joined_at: Date | string | null;
  created_at: Date | string;
}

export type RowLock = "none" | "update" | "share";

const COLUMNS = sql`id, user_id, email, full_name, status, token_hash, token_expires_at, joined_at,
  created_at`;

const lockClause = (lock: RowLock): SQL =>
  lock === "update" ? sql` FOR UPDATE` : lock === "share" ? sql` FOR SHARE` : sql``;

const iso = (value: Date | string) => new Date(value).toISOString();

/**
 * صف الحساب بشكل الـ contract: مفيش hash ولا انتهاء رابط ولا user id.
 *
 * @param row الصف
 * @returns الحساب
 */
export function toPlatformAccount(row: PlatformAccountRow): PlatformAccountResponse {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    status: row.status,
    joinedAt: row.joined_at === null ? null : iso(row.joined_at),
    createdAt: iso(row.created_at),
  };
}

async function one(tx: Tx, where: SQL, lock: RowLock): Promise<PlatformAccountRow | null> {
  const rows = await tx.execute<PlatformAccountRow>(
    sql`SELECT ${COLUMNS} FROM platform_accounts WHERE ${where}${lockClause(lock)}`,
  );
  return rows[0] ?? null;
}

/** الحساب بالـ id. */
export const accountById = (tx: Tx, id: string, lock: RowLock = "none") =>
  one(tx, sql`id = ${id}`, lock);

/** الحساب بالإيميل (lower-case). */
export const accountByEmail = (tx: Tx, email: string, lock: RowLock = "none") =>
  one(tx, sql`email = ${email.trim().toLowerCase()}`, lock);

/** الحساب اللي رابطه المعلّق ليه الـ hash ده. */
export const accountByTokenHash = (tx: Tx, hash: string, lock: RowLock = "none") =>
  one(tx, sql`token_hash = ${hash}`, lock);

/** الحساب المربوط بمستخدم Better Auth ده. */
export const accountByUser = (tx: Tx, userId: string) => one(tx, sql`user_id = ${userId}`, "none");

/**
 * قفل واحد لكل تغييرات الفريق (ADM-02): عدّ الحسابات النشطة ومنع تعطيل آخر واحد بيحصلوا تحته.
 *
 * @param tx الـ transaction
 * @returns بيخلص لما القفل يتمسك
 */
export async function lockPlatformTeam(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('platform_team', 0))`);
}

/** عدد الحسابات النشطة غير الحساب ده. */
export async function otherActiveCount(tx: Tx, exceptId: string): Promise<number> {
  const rows = await tx.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM platform_accounts WHERE status = 'active' AND id <> ${exceptId}`,
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * يحجز الإيميل لفريق المنصة (0015): `false` لو أي عيادة أو حساب ماسكه.
 *
 * @param tx الـ transaction
 * @param email الإيميل
 * @returns `true` لو اتحجز
 */
export async function reservePlatformEmail(tx: Tx, email: string): Promise<boolean> {
  const rows = await tx.execute<{ ok: boolean }>(
    sql`SELECT reserve_platform_email(${email}) AS ok`,
  );
  return rows[0]?.ok === true;
}

/** بيانات حساب مدعو جديد. */
export interface NewInvitedAccount {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly tokenHash: string;
  readonly tokenExpiresAt: Date;
  readonly invitedBy: string;
  readonly now: Date;
}

/** يكتب حساب مدعو. */
export async function insertInvitedAccount(tx: Tx, a: NewInvitedAccount): Promise<void> {
  await tx.execute(
    sql`INSERT INTO platform_accounts (id, user_id, email, full_name, status, token_hash,
          token_expires_at, invited_by, joined_at, created_at, updated_at)
        VALUES (${a.id}, NULL, ${a.email}, ${a.fullName}, 'invited', ${a.tokenHash},
          ${a.tokenExpiresAt.toISOString()}::timestamptz, ${a.invitedBy}, NULL,
          ${a.now.toISOString()}::timestamptz, ${a.now.toISOString()}::timestamptz)`,
  );
}

/** رابط جديد لحساب لسه مدعو: الـ hash القديم بيموت. */
export async function reissueLink(
  tx: Tx,
  id: string,
  link: { hash: string; expiresAt: Date; invitedBy: string; now: Date },
): Promise<void> {
  await tx.execute(
    sql`UPDATE platform_accounts SET token_hash = ${link.hash},
          token_expires_at = ${link.expiresAt.toISOString()}::timestamptz,
          invited_by = ${link.invitedBy}, updated_at = ${link.now.toISOString()}::timestamptz
        WHERE id = ${id}`,
  );
}

/**
 * يغيّر الحالة. التعطيل بيمسح الرابط المعلّق، فالرابط اللي اتبعت مايشتغلش تاني.
 *
 * @param tx الـ transaction
 * @param id الحساب
 * @param status الحالة الجديدة
 * @param now الوقت
 * @returns بيخلص بعد الكتابة
 */
export async function setAccountStatus(
  tx: Tx,
  id: string,
  status: PlatformAccountStatus,
  now: Date,
): Promise<void> {
  const clearLink = status === "deactivated";
  await tx.execute(
    sql`UPDATE platform_accounts SET status = ${status},
          token_hash = CASE WHEN ${clearLink} THEN NULL ELSE token_hash END,
          token_expires_at = CASE WHEN ${clearLink} THEN NULL ELSE token_expires_at END,
          updated_at = ${now.toISOString()}::timestamptz
        WHERE id = ${id}`,
  );
}

/** الحساب انضم: مربوط بالمستخدم، نشط، والرابط اتمسح. */
export async function markJoined(tx: Tx, id: string, userId: string, now: Date): Promise<void> {
  await tx.execute(
    sql`UPDATE platform_accounts SET user_id = ${userId}, status = 'active',
          joined_at = ${now.toISOString()}::timestamptz, token_hash = NULL, token_expires_at = NULL,
          updated_at = ${now.toISOString()}::timestamptz
        WHERE id = ${id}`,
  );
}

/**
 * صفحة من الفريق، الأقدم الأول. الـ cursor هو آخر id اتشاف.
 *
 * @param tx الـ transaction
 * @param after آخر id، أو `null`
 * @param limit الحد
 * @returns الصفوف (limit + 1 عشان نعرف فيه بعدها) والعدد الكلي
 */
export async function pageAccounts(
  tx: Tx,
  after: string | null,
  limit: number,
): Promise<{ rows: PlatformAccountRow[]; total: number }> {
  const rows = await tx.execute<PlatformAccountRow>(
    sql`SELECT ${COLUMNS} FROM platform_accounts
        WHERE ${after}::uuid IS NULL
           OR (created_at, id) > (SELECT created_at, id FROM platform_accounts WHERE id = ${after}::uuid)
        ORDER BY created_at, id
        LIMIT ${limit + 1}`,
  );
  const total = await tx.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM platform_accounts`,
  );
  return { rows: [...rows], total: Number(total[0]?.n ?? 0) };
}
