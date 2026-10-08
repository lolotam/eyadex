import type { ClinicModule } from "@eyadex/contracts/clinics";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

// SQL of the role writes (ADR-0017). Every function runs inside the caller's withTenant(clinicId)
// transaction, so RLS confines it to that clinic.

export interface RoleRow {
  readonly id: string;
  readonly systemKey: string | null;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly isLocked: boolean;
  readonly isActive: boolean;
  /** Sorted. */
  readonly permissionKeys: readonly string[];
}

/** The role, row-locked; `null` = unknown in this clinic (another clinic's id included). */
export async function findRoleForUpdate(
  tx: Tx,
  clinicId: string,
  id: string,
): Promise<RoleRow | null> {
  const rows = await tx.execute<{
    id: string;
    system_key: string | null;
    name_ar: string;
    name_en: string;
    is_locked: boolean;
    is_active: boolean;
  }>(
    sql`SELECT id, system_key, name_ar, name_en, is_locked, is_active FROM roles
        WHERE clinic_id = ${clinicId} AND id = ${id} FOR UPDATE`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    systemKey: row.system_key,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    isLocked: row.is_locked,
    isActive: row.is_active,
    permissionKeys: await roleKeys(tx, clinicId, id),
  };
}

async function roleKeys(tx: Tx, clinicId: string, roleId: string): Promise<string[]> {
  const rows = await tx.execute<{ key: string }>(
    sql`SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.clinic_id = ${clinicId} AND rp.role_id = ${roleId} ORDER BY p.key`,
  );
  return rows.map((row) => row.key);
}

/** Modules enabled for the clinic, read in the writing transaction (a module with no row is off). */
export async function readEnabledModules(tx: Tx, clinicId: string): Promise<ClinicModule[]> {
  const rows = await tx.execute<{ module: ClinicModule }>(
    sql`SELECT module FROM clinic_features WHERE clinic_id = ${clinicId} AND enabled ORDER BY module`,
  );
  return rows.map((row) => row.module);
}

/** Memberships on the role in ANY status: deactivated members must be moved first (mock rule). */
export async function countRoleMembers(tx: Tx, clinicId: string, roleId: string): Promise<number> {
  const rows = await tx.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM memberships WHERE clinic_id = ${clinicId} AND role_id = ${roleId}`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** A new custom role (no system key, never locked). Names are trimmed by the contract already. */
export async function insertRole(
  tx: Tx,
  clinicId: string,
  role: { id: string; nameAr: string; nameEn: string },
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`INSERT INTO roles (clinic_id, id, system_key, name_ar, name_en, is_locked, is_active,
          created_at, updated_at)
        VALUES (${clinicId}, ${role.id}, NULL, ${role.nameAr}, ${role.nameEn}, false, true,
          ${at}::timestamptz, ${at}::timestamptz)`,
  );
}

export async function saveRole(
  tx: Tx,
  clinicId: string,
  role: { id: string; nameAr: string; nameEn: string; isActive: boolean },
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE roles SET name_ar = ${role.nameAr}, name_en = ${role.nameEn},
          is_active = ${role.isActive}, updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${role.id}`,
  );
}

/**
 * Makes the role's link rows exactly `keys` (link rows may be deleted, 0016; the role never is).
 * Only the difference is written, so an unchanged key keeps its row.
 */
export async function replaceRolePermissions(
  tx: Tx,
  clinicId: string,
  roleId: string,
  keys: readonly string[],
  newId: () => string,
  now: Date,
): Promise<void> {
  const wanted = JSON.stringify([...new Set(keys)]);
  await tx.execute(
    sql`DELETE FROM role_permissions rp USING permissions p
        WHERE rp.clinic_id = ${clinicId} AND rp.role_id = ${roleId} AND p.id = rp.permission_id
          AND p.key NOT IN (SELECT value FROM jsonb_array_elements_text(${wanted}::jsonb))`,
  );
  const missing = await tx.execute<{ id: string }>(
    sql`SELECT p.id FROM permissions p
        WHERE p.key IN (SELECT value FROM jsonb_array_elements_text(${wanted}::jsonb))
          AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.clinic_id = ${clinicId}
                            AND rp.role_id = ${roleId} AND rp.permission_id = p.id)
        ORDER BY p.key`,
  );
  for (const permission of missing) {
    await tx.execute(
      sql`INSERT INTO role_permissions (clinic_id, id, role_id, permission_id, created_at)
          VALUES (${clinicId}, ${newId()}, ${roleId}, ${permission.id}, ${now.toISOString()}::timestamptz)`,
    );
  }
}
