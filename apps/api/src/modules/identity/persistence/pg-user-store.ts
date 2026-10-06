import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { ApiError } from "../../../shared/errors.ts";
import { CLINIC_ADMIN_KEY } from "../domain/user-rules.ts";

// SQL shared by the user and invitation use cases (ADR-0012). Every function runs inside the
// caller's withTenant(clinicId) transaction, so RLS confines it to that clinic.

/**
 * Serialises every write that takes a seat or touches the last admin. Its own key, not the branches
 * one: a user write and a branch write never block each other for nothing (ADR-0012).
 */
export async function lockClinicUsers(tx: Tx, clinicId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`users:${clinicId}`}, 0))`);
}

/** Same key as tenancy's `lockClinicBranches` (ADR-0011); taken AFTER the users lock, never before. */
export async function lockClinicBranches(tx: Tx, clinicId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`branches:${clinicId}`}, 0))`,
  );
}

/** Seats taken (active memberships + live pending invitations) and `max_users`. */
export async function readSeats(
  tx: Tx,
  clinicId: string,
  now: Date,
): Promise<{ members: number; invitations: number; max: number }> {
  const rows = await tx.execute<{ members: number; invitations: number; max: number | null }>(
    sql`SELECT
          (SELECT count(*)::int FROM memberships
            WHERE clinic_id = ${clinicId} AND status = 'active') AS members,
          (SELECT count(*)::int FROM invitations
            WHERE clinic_id = ${clinicId} AND status = 'pending'
              AND expires_at > ${now.toISOString()}::timestamptz) AS invitations,
          (SELECT max_users FROM clinics WHERE id = ${clinicId}) AS max`,
  );
  const row = rows[0];
  if (row === undefined || row.max === null) throw new ApiError("not_found");
  return {
    members: Number(row.members),
    invitations: Number(row.invitations),
    max: Number(row.max),
  };
}

export interface RoleRef {
  readonly id: string;
  readonly systemKey: string | null;
  readonly nameAr: string;
  readonly nameEn: string;
}

/** An ACTIVE role of this clinic: unknown (another clinic's id included) → 404, inactive → 400. */
export async function activeRole(tx: Tx, clinicId: string, roleId: string): Promise<RoleRef> {
  const rows = await tx.execute<{
    id: string;
    system_key: string | null;
    name_ar: string;
    name_en: string;
    is_active: boolean;
  }>(
    sql`SELECT id, system_key, name_ar, name_en, is_active FROM roles
        WHERE clinic_id = ${clinicId} AND id = ${roleId}`,
  );
  const row = rows[0];
  if (row === undefined) throw new ApiError("not_found");
  if (!row.is_active) throw new ApiError("role_inactive");
  return { id: row.id, systemKey: row.system_key, nameAr: row.name_ar, nameEn: row.name_en };
}

/** Every id is an ACTIVE branch of this clinic: an unknown one → 404, an inactive one → 400. */
export async function assertActiveBranches(
  tx: Tx,
  clinicId: string,
  branchIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(branchIds)];
  if (unique.length === 0) return;
  const rows = await tx.execute<{ id: string; is_active: boolean }>(
    sql`SELECT id, is_active FROM branches WHERE clinic_id = ${clinicId}
          AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(unique)}::jsonb))`,
  );
  if (rows.length !== unique.length) throw new ApiError("not_found");
  if (rows.some((row) => !row.is_active)) throw new ApiError("branch_inactive");
}

/** Active members on the clinic-admin system role (by its key, never its name). */
export async function countActiveAdmins(tx: Tx, clinicId: string): Promise<number> {
  const rows = await tx.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM memberships m
        JOIN roles r ON r.clinic_id = m.clinic_id AND r.id = m.role_id
        WHERE m.clinic_id = ${clinicId} AND m.status = 'active' AND r.system_key = ${CLINIC_ADMIN_KEY}`,
  );
  return Number(rows[0]?.n ?? 0);
}

export interface MemberRow {
  readonly id: string;
  readonly userId: string;
  readonly roleId: string;
  readonly roleSystemKey: string | null;
  readonly status: "active" | "deactivated";
  readonly allBranches: boolean;
  readonly branchIds: readonly string[];
}

/** The membership, row-locked; `null` = unknown here. */
export async function findMemberForUpdate(
  tx: Tx,
  clinicId: string,
  id: string,
): Promise<MemberRow | null> {
  const rows = await tx.execute<{
    id: string;
    user_id: string;
    role_id: string;
    status: "active" | "deactivated";
    all_branches: boolean;
  }>(
    sql`SELECT id, user_id, role_id, status, all_branches FROM memberships
        WHERE clinic_id = ${clinicId} AND id = ${id} FOR UPDATE`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  const extra = await tx.execute<{ system_key: string | null; branch_ids: string[] | null }>(
    sql`SELECT (SELECT system_key FROM roles WHERE clinic_id = ${clinicId} AND id = ${row.role_id})
                 AS system_key,
               (SELECT array_agg(branch_id::text ORDER BY branch_id) FROM membership_branches
                 WHERE clinic_id = ${clinicId} AND membership_id = ${id}) AS branch_ids`,
  );
  return {
    id: row.id,
    userId: row.user_id,
    roleId: row.role_id,
    roleSystemKey: extra[0]?.system_key ?? null,
    status: row.status,
    allBranches: row.all_branches,
    branchIds: extra[0]?.branch_ids ?? [],
  };
}

export async function saveMemberRoleAndStatus(
  tx: Tx,
  clinicId: string,
  member: Pick<MemberRow, "id" | "roleId" | "status">,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE memberships SET role_id = ${member.roleId}, status = ${member.status},
          updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${member.id}`,
  );
}

/** Replaces the branch links (link rows may be deleted, 0016; the membership never is). */
export async function saveMemberBranches(
  tx: Tx,
  clinicId: string,
  memberId: string,
  allBranches: boolean,
  branchIds: readonly string[],
  newId: () => string,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`UPDATE memberships SET all_branches = ${allBranches}, updated_at = ${at}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${memberId}`,
  );
  await tx.execute(
    sql`DELETE FROM membership_branches WHERE clinic_id = ${clinicId} AND membership_id = ${memberId}`,
  );
  for (const branchId of allBranches ? [] : [...new Set(branchIds)]) {
    await tx.execute(
      sql`INSERT INTO membership_branches (clinic_id, id, membership_id, branch_id, created_at)
          VALUES (${clinicId}, ${newId()}, ${memberId}, ${branchId}, ${at}::timestamptz)`,
    );
  }
}
