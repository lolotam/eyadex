import { sql, type Database, type IdGenerator, type Tx } from "@eyadex/db";
import { redactSecrets } from "@eyadex/observability";

import {
  invitationSnapshot,
  isOrphaned,
  shownStatus,
  type InvitationAuditFields,
} from "../domain/orphan-rule.ts";
import type {
  OrphanCancelRequest,
  OrphanInvitationCanceller,
} from "../ports/orphan-invitation-canceller.ts";

type Row = {
  id: string;
  status: "pending" | "accepted" | "cancelled";
  all_branches: boolean;
  email: string;
  full_name: string;
  role_id: string;
  role_name_ar: string;
  role_name_en: string;
  expires_at: string;
  // JSON text: the driver hands arrays back as unparsed text through tx.execute.
  branch_ids: string;
  active_branches: number;
};

export const AUTO_CANCELLED = "invitation.auto_cancelled";

// The same keys and function as the API's lockClinicUsers / lockClinicBranches: one lock space.
const advisory = (tx: Tx, key: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);

/**
 * SQL الإلغاء التلقائي على pool الـ `eyadex_app` تحت `withTenant` (الـ RLS بيقصرها على عيادة الحدث).
 * الـ worker مابيستوردش كود الـ API، فالـ SQL هنا مكتوب بنفس قواعد الإلغاء اليدوي.
 */
export class PgOrphanInvitationCanceller implements OrphanInvitationCanceller {
  readonly #db: Database;
  readonly #ids: IdGenerator;

  constructor(db: Database, ids: IdGenerator) {
    this.#db = db;
    this.#ids = ids;
  }

  cancelOrphaned(request: OrphanCancelRequest, now: () => Date): Promise<number> {
    const { clinicId, branchId } = request;
    return this.#db.withTenant(clinicId, async (tx) => {
      // Lock order (ADR-0012 §16): users → invitation rows (by id) → branches → clock → fresh read.
      await advisory(tx, `users:${clinicId}`);
      const locked = (await tx.execute(
        sql`SELECT i.id FROM invitations i
            WHERE i.clinic_id = ${clinicId} AND i.status = 'pending' AND NOT i.all_branches
              AND EXISTS (
                SELECT 1 FROM invitation_branches eb
                WHERE eb.clinic_id = i.clinic_id AND eb.invitation_id = i.id AND eb.branch_id = ${branchId})
              AND NOT EXISTS (
                SELECT 1 FROM invitation_branches ib
                JOIN branches b ON b.clinic_id = ib.clinic_id AND b.id = ib.branch_id
                WHERE ib.clinic_id = i.clinic_id AND ib.invitation_id = i.id AND b.is_active)
            ORDER BY i.id FOR UPDATE OF i`,
      )) as unknown as { id: string }[];
      if (locked.length === 0) return 0;
      await advisory(tx, `branches:${clinicId}`);
      if (await this.#superseded(tx, request)) return 0;
      const at = now();
      const rows = await this.#fresh(
        tx,
        clinicId,
        locked.map((r) => r.id),
      );
      let cancelled = 0;
      for (const row of rows) {
        const decision = {
          id: row.id,
          status: row.status,
          allBranches: row.all_branches,
          activeBranchCount: Number(row.active_branches),
        };
        if (!isOrphaned(decision)) continue;
        await this.#cancel(tx, request, row, at);
        cancelled += 1;
      }
      return cancelled;
    });
  }

  // A reactivation after this event means a later deactivation (if any) has its own event and actor, so
  // this one must not cancel and audit in the older admin's name. Read under the branches lock, which
  // reactivation takes too.
  async #superseded(tx: Tx, request: OrphanCancelRequest): Promise<boolean> {
    const rows = (await tx.execute(
      sql`SELECT 1 FROM audit_log
          WHERE clinic_id = ${request.clinicId} AND entity_type = 'branch'
            AND entity_id = ${request.branchId} AND action = 'branch.reactivated'
            AND created_at > ${request.deactivatedAt.toISOString()}::timestamptz
          LIMIT 1`,
    )) as unknown as unknown[];
    return rows.length > 0;
  }

  async #fresh(tx: Tx, clinicId: string, ids: string[]): Promise<Row[]> {
    return (await tx.execute(
      sql`SELECT i.id, i.status, i.all_branches, i.email, i.full_name, i.role_id,
                 r.name_ar AS role_name_ar, r.name_en AS role_name_en, i.expires_at::text AS expires_at,
                 coalesce(json_agg(ib.branch_id) FILTER (WHERE ib.branch_id IS NOT NULL), '[]')::text
                   AS branch_ids,
                 count(*) FILTER (WHERE b.is_active) AS active_branches
          FROM invitations i
          JOIN roles r ON r.clinic_id = i.clinic_id AND r.id = i.role_id
          LEFT JOIN invitation_branches ib ON ib.clinic_id = i.clinic_id AND ib.invitation_id = i.id
          LEFT JOIN branches b ON b.clinic_id = ib.clinic_id AND b.id = ib.branch_id
          WHERE i.clinic_id = ${clinicId}
            AND i.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)
          GROUP BY i.clinic_id, i.id, r.name_ar, r.name_en
          ORDER BY i.id`,
    )) as unknown as Row[];
  }

  async #cancel(tx: Tx, request: OrphanCancelRequest, row: Row, at: Date): Promise<void> {
    const { clinicId } = request;
    const iso = at.toISOString();
    await tx.execute(sql`SELECT release_invitation_email(${row.email}, ${row.id})`);
    await tx.execute(
      sql`UPDATE invitations SET status = 'cancelled', responded_at = ${iso}::timestamptz
          WHERE clinic_id = ${clinicId} AND id = ${row.id}`,
    );
    const fields: InvitationAuditFields = {
      fullName: row.full_name,
      email: row.email,
      roleId: row.role_id,
      roleNameAr: row.role_name_ar,
      roleNameEn: row.role_name_en,
      allBranches: row.all_branches,
      branchIds: JSON.parse(row.branch_ids) as string[],
      expiresAt: new Date(row.expires_at),
    };
    const details = redactSecrets({
      reason: "branch_deactivated",
      branchId: request.branchId,
      eventId: request.eventId,
      before: invitationSnapshot(fields, shownStatus(fields.expiresAt, at)),
      after: invitationSnapshot(fields, "cancelled"),
    });
    await tx.execute(
      sql`INSERT INTO audit_log (clinic_id, id, actor_user_id, action, category, entity_type,
            entity_id, branch_id, details, created_at)
          VALUES (${clinicId}, ${this.#ids.newId()}, ${request.actorUserId}, ${AUTO_CANCELLED},
            'administrative', 'invitation', ${row.id}, NULL, ${JSON.stringify(details)}::jsonb,
            ${iso}::timestamptz)`,
    );
  }
}
