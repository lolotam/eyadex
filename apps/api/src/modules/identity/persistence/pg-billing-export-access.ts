import { sql, type Tx } from "@eyadex/db";

/** Narrow current-access adapter, bound to billing's port only in billing.module.ts. */
export class PgBillingExportAccess {
  async read(tx: Tx, clinicId: string, userId: string) {
    const rows = await tx.execute<{
      userId: string;
      membershipId: string;
      active: boolean;
      roleActive: boolean;
      clinicStatus: string;
      expiresAt: string;
      financeEnabled: boolean;
      permissions: string[];
      allBranches: boolean;
      branchIds: string[];
    }>(sql`SELECT m.user_id AS "userId", m.id AS "membershipId", m.status = 'active' AS active,
      r.is_active AS "roleActive", c.status AS "clinicStatus",
      to_char(c.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "expiresAt",
      COALESCE((SELECT enabled FROM clinic_features WHERE clinic_id = m.clinic_id AND module = 'finance'), false) AS "financeEnabled",
      COALESCE((SELECT jsonb_agg(p.key ORDER BY p.key) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.clinic_id = m.clinic_id AND rp.role_id = m.role_id), '[]'::jsonb) AS permissions,
      m.all_branches AS "allBranches",
      COALESCE((SELECT jsonb_agg(mb.branch_id) FROM membership_branches mb
        JOIN branches b ON b.clinic_id = mb.clinic_id AND b.id = mb.branch_id
        WHERE mb.clinic_id = m.clinic_id AND mb.membership_id = m.id AND b.is_active), '[]'::jsonb) AS "branchIds"
      FROM memberships m JOIN roles r ON r.clinic_id = m.clinic_id AND r.id = m.role_id
      JOIN clinics c ON c.id = m.clinic_id WHERE m.clinic_id = ${clinicId} AND m.user_id = ${userId}`);
    return rows[0] ?? null;
  }
}
