import { sql, type Database } from "@eyadex/db";

import type { InvitationState, InvitationStateReader } from "../ports/invitation-state-reader.ts";

type Row = {
  status: InvitationState["status"];
  expires_at: string;
  token_hash: string;
  timezone: string;
  all_branches: boolean;
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
        sql`SELECT i.status, i.expires_at::text AS expires_at, i.token_hash, c.timezone, i.all_branches
            FROM invitations i JOIN clinics c ON c.id = i.clinic_id
            WHERE i.clinic_id = ${clinicId} AND i.id = ${invitationId}
            FOR SHARE OF i`,
      )) as unknown as Row[];
      const row = rows[0];
      if (row === undefined) return use(null);
      // The invitation's branch rows stay locked FOR SHARE through the send too: a deactivation takes its
      // branch FOR UPDATE, so it waits instead of landing between this read and the email (ADR-0013 §4).
      const branches = row.all_branches
        ? []
        : ((await tx.execute(
            sql`SELECT b.is_active FROM invitation_branches ib
                JOIN branches b ON b.clinic_id = ib.clinic_id AND b.id = ib.branch_id
                WHERE ib.clinic_id = ${clinicId} AND ib.invitation_id = ${invitationId}
                ORDER BY b.id FOR SHARE OF b`,
          )) as unknown as { is_active: boolean }[]);
      return use({
        status: row.status,
        expiresAt: new Date(row.expires_at),
        tokenHash: row.token_hash,
        hasActiveBranch: row.all_branches || branches.some((b) => b.is_active),
        timezone: row.timezone,
      });
    });
  }
}
