import type { BranchDetail } from "@eyadex/contracts/branches";

/** The stored columns; `exclusiveMemberCount` is added from identity's port (ADR-0012). */
export type BranchFields = Omit<BranchDetail, "exclusiveMemberCount">;
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

// SQL for the branch use cases (ADR-0011). Every function runs inside the caller's
// withTenant(clinicId) transaction, so RLS confines it to that clinic.

interface BranchRow {
  id: string;
  name_ar: string;
  name_en: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

const iso = (value: Date | string) => new Date(value).toISOString();

export const BRANCH_COLUMNS = sql`id, name_ar, name_en, address, phone, is_active, created_at, updated_at`;

export const toBranch = (row: BranchRow): BranchFields => ({
  id: row.id,
  nameAr: row.name_ar,
  nameEn: row.name_en,
  address: row.address,
  phone: row.phone,
  isActive: row.is_active,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

/**
 * Serialises every create/deactivate/reactivate of one clinic's branches. A transaction advisory lock,
 * not `clinics … FOR UPDATE`: eyadex_app has no UPDATE on clinics and must not get one (ADR-0011).
 */
export async function lockClinicBranches(tx: Tx, clinicId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`branches:${clinicId}`}, 0))`,
  );
}

/** `max_branches` of the clinic in context; `null` when the clinic is not visible. */
export async function readMaxBranches(tx: Tx, clinicId: string): Promise<number | null> {
  const rows = await tx.execute<{ max_branches: number }>(
    sql`SELECT max_branches FROM clinics WHERE id = ${clinicId}`,
  );
  return rows[0] === undefined ? null : Number(rows[0].max_branches);
}

export async function countActiveBranches(tx: Tx, clinicId: string): Promise<number> {
  const rows = await tx.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM branches WHERE clinic_id = ${clinicId} AND is_active`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** The branch, row-locked for the change; `null` = unknown here (another clinic's id included). */
export async function findBranchForUpdate(
  tx: Tx,
  clinicId: string,
  id: string,
): Promise<BranchFields | null> {
  const rows = await tx.execute<BranchRow>(
    sql`SELECT ${BRANCH_COLUMNS} FROM branches
        WHERE clinic_id = ${clinicId} AND id = ${id} FOR UPDATE`,
  );
  return rows[0] === undefined ? null : toBranch(rows[0]);
}

export async function findBranch(
  tx: Tx,
  clinicId: string,
  id: string,
): Promise<BranchFields | null> {
  const rows = await tx.execute<BranchRow>(
    sql`SELECT ${BRANCH_COLUMNS} FROM branches WHERE clinic_id = ${clinicId} AND id = ${id}`,
  );
  return rows[0] === undefined ? null : toBranch(rows[0]);
}

export async function insertBranch(
  tx: Tx,
  clinicId: string,
  branch: Omit<BranchFields, "createdAt" | "updatedAt">,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`INSERT INTO branches (clinic_id, id, name_ar, name_en, address, phone, is_active,
          created_at, updated_at)
        VALUES (${clinicId}, ${branch.id}, ${branch.nameAr}, ${branch.nameEn}, ${branch.address},
          ${branch.phone}, ${branch.isActive}, ${at}::timestamptz, ${at}::timestamptz)`,
  );
}

/** Writes the editable fields and the status in one statement. */
export async function saveBranch(
  tx: Tx,
  clinicId: string,
  branch: BranchFields,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE branches SET name_ar = ${branch.nameAr}, name_en = ${branch.nameEn},
          address = ${branch.address}, phone = ${branch.phone}, is_active = ${branch.isActive},
          updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${branch.id}`,
  );
}
