import type { RoleSummary } from "@eyadex/contracts/access";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** A `roles r` row with its counts and keys, as `roleSummaryColumns` selects it. */
export interface RoleSummaryRow {
  id: string;
  system_key: RoleSummary["systemKey"];
  name_ar: string;
  name_en: string;
  is_locked: boolean;
  is_active: boolean;
  active_users: number;
  member_count: number;
  permission_keys: string[] | null;
}

/**
 * The select list over `roles r` shared by the list and the single-role read. The keys are a jsonb
 * array: the pool runs with `fetch_types: false`, so a `text[]` would arrive as the literal "{…}".
 */
export const roleSummaryColumns = sql`r.id, r.system_key, r.name_ar, r.name_en, r.is_locked, r.is_active,
  (SELECT count(*)::int FROM memberships m
     WHERE m.clinic_id = r.clinic_id AND m.role_id = r.id AND m.status = 'active') AS active_users,
  (SELECT count(*)::int FROM memberships m
     WHERE m.clinic_id = r.clinic_id AND m.role_id = r.id) AS member_count,
  (SELECT jsonb_agg(p.key ORDER BY p.key) FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.clinic_id = r.clinic_id AND rp.role_id = r.id) AS permission_keys`;

/**
 * صف الدور بشكل `RoleSummary`.
 *
 * @param row الصف من `roleSummaryColumns`
 * @returns الدور
 */
export function toRoleSummary(row: RoleSummaryRow): RoleSummary {
  return {
    id: row.id,
    systemKey: row.system_key,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    isLocked: row.is_locked,
    isActive: row.is_active,
    activeUserCount: Number(row.active_users),
    memberCount: Number(row.member_count),
    permissionKeys: row.permission_keys ?? [],
  };
}

/**
 * دور واحد بشكل القايمة، جوه transaction الكتابة (بعد التغيير أو للـ replay).
 *
 * @param tx transaction العيادة
 * @param clinicId العيادة
 * @param id الدور
 * @returns الدور، أو `null` لو مش في العيادة دي
 */
export async function findRoleSummary(
  tx: Tx,
  clinicId: string,
  id: string,
): Promise<RoleSummary | null> {
  const rows = await tx.execute<RoleSummaryRow>(
    sql`SELECT ${roleSummaryColumns} FROM roles r WHERE r.clinic_id = ${clinicId} AND r.id = ${id}`,
  );
  const row = rows[0];
  return row === undefined ? null : toRoleSummary(row);
}
