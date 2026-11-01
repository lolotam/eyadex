import { sql, type Tx } from "@eyadex/db";

import type { ExportAccessSnapshot } from "../domain/export-access.ts";

interface AccessRow {
  user_id: string;
  membership_status: string;
  all_branches: boolean;
  role_active: boolean;
  clinic_status: string;
  expires_us: string | number;
  observed_us: string | number;
  finance_enabled: boolean;
  permission_keys: unknown;
  active_branch_ids: unknown;
  clinic_branch_ids: unknown;
}

/**
 * يقرأ عضوية الطالب الحالية تحت نفس العيادة. من غير كاش، ومن غير أسماء أو جلسة أو صفوف تقرير.
 * مصفوفات JSON عشان السائق ما يلتبسش في مصفوفة Postgres.
 *
 * @param tx معاملة `withTenant`
 * @param clinicId العيادة الموثوقة من السياج
 * @param membershipId عضوية `requested_by`
 * @returns اللقطة أو `null` لو العضوية مش في العيادة
 */
export async function readExportAccess(
  tx: Tx,
  clinicId: string,
  membershipId: string,
): Promise<ExportAccessSnapshot | null> {
  const rows =
    (await tx.execute(sql`SELECT /* active_branch_ids */ m.user_id, m.status AS membership_status, m.all_branches,
            r.is_active AS role_active,
            c.status AS clinic_status,
            (extract(epoch FROM c.expires_at) * 1000000)::bigint::text AS expires_us,
            (extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text AS observed_us,
            COALESCE((SELECT cf.enabled FROM clinic_features cf
                       WHERE cf.clinic_id = m.clinic_id AND cf.module = 'finance'), false) AS finance_enabled,
            COALESCE((SELECT jsonb_agg(p.key ORDER BY p.key) FROM role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                       WHERE rp.clinic_id = m.clinic_id AND rp.role_id = m.role_id), '[]'::jsonb) AS permission_keys,
            COALESCE((SELECT jsonb_agg(mb.branch_id ORDER BY mb.branch_id) FROM membership_branches mb
                        JOIN branches b ON b.clinic_id = mb.clinic_id AND b.id = mb.branch_id
                       WHERE mb.clinic_id = m.clinic_id AND mb.membership_id = m.id AND b.is_active),
                     '[]'::jsonb) AS active_branch_ids,
            COALESCE((SELECT jsonb_agg(b.id ORDER BY b.id) FROM branches b
                       WHERE b.clinic_id = m.clinic_id), '[]'::jsonb) AS clinic_branch_ids
       FROM memberships m
       JOIN roles r ON r.clinic_id = m.clinic_id AND r.id = m.role_id
       JOIN clinics c ON c.id = m.clinic_id
      WHERE m.clinic_id = ${clinicId} AND m.id = ${membershipId}`)) as unknown as AccessRow[];
  const row = rows[0];
  if (row === undefined) return null;
  return {
    userId: row.user_id,
    membershipActive: row.membership_status === "active",
    roleActive: row.role_active === true,
    clinicStatus: row.clinic_status,
    expiresUs: String(row.expires_us),
    observedUs: String(row.observed_us),
    financeEnabled: row.finance_enabled === true,
    permissions: stringList(row.permission_keys),
    allBranches: row.all_branches === true,
    activeAssignedBranchIds: stringList(row.active_branch_ids),
    clinicBranchIds: stringList(row.clinic_branch_ids),
  };
}

function stringList(value: unknown): readonly string[] {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new TypeError("export access snapshot is malformed");
  }
  return parsed;
}
