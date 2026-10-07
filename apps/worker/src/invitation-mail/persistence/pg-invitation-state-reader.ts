import { sql, type Database } from "@eyadex/db";

import type { InvitationState, InvitationStateReader } from "../ports/invitation-state-reader.ts";

type Row = {
  status: InvitationState["status"];
  expires_at: string;
  token_hash: string;
  timezone: string;
};

/**
 * القراءة على pool الـ `eyadex_app` تحت `withTenant` — الـ RLS بيقصرها على عيادة الحدث. الصف بيفضل
 * ممسوك `FOR SHARE` طول `use`، والـ API بياخد نفس الصف `FOR UPDATE` قبل أي تغيير.
 */
export class PgInvitationStateReader implements InvitationStateReader {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  whileLocked<T>(
    clinicId: string,
    invitationId: string,
    use: (state: InvitationState | null) => Promise<T>,
  ): Promise<T> {
    return this.#db.withTenant(clinicId, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT i.status, i.expires_at::text AS expires_at, i.token_hash, c.timezone
            FROM invitations i JOIN clinics c ON c.id = i.clinic_id
            WHERE i.clinic_id = ${clinicId} AND i.id = ${invitationId}
            FOR SHARE OF i`,
      )) as unknown as Row[];
      const row = rows[0];
      if (row === undefined) return use(null);
      return use({
        status: row.status,
        expiresAt: new Date(row.expires_at),
        tokenHash: row.token_hash,
        timezone: row.timezone,
      });
    });
  }
}
