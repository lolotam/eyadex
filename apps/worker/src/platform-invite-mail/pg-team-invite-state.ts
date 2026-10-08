import { sql, type Database } from "@eyadex/db";

import type { TeamInviteState } from "./domain/team-invite.ts";

/** قارئ صف الحساب وقت الإرسال، والصف ممسوك لحد ما الإرسال يرجع. */
export interface TeamInviteStateReader {
  /**
   * يمسك صف الحساب `FOR SHARE` (دعوة تانية أو تعطيل بيستنوا) ويشغّل `fn` وهو ممسوك.
   *
   * @param accountId الحساب
   * @param fn القرار والإرسال
   * @returns نتيجة `fn`
   */
  whileLocked<T>(accountId: string, fn: (state: TeamInviteState | null) => Promise<T>): Promise<T>;
}

/**
 * على pool المنصة (`eyadex_platform`، الجدول ده بس من غير عيادة، 0037). نفس قاعدة ADR-0013: الرابط
 * اللي اتفحص هو الرابط اللي اتبعت.
 */
export class PgTeamInviteStateReader implements TeamInviteStateReader {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  whileLocked<T>(accountId: string, fn: (state: TeamInviteState | null) => Promise<T>): Promise<T> {
    return this.#db.withNoTenant(async (tx) => {
      const row = (
        (await tx.execute(
          sql`SELECT status, token_hash, token_expires_at FROM platform_accounts
              WHERE id = ${accountId} FOR SHARE`,
        )) as unknown as {
          status: TeamInviteState["status"];
          token_hash: string | null;
          token_expires_at: string | null;
        }[]
      )[0];
      return fn(
        row === undefined
          ? null
          : {
              status: row.status,
              tokenHash: row.token_hash,
              tokenExpiresAt: row.token_expires_at === null ? null : new Date(row.token_expires_at),
            },
      );
    });
  }
}
