import type { UserListHttpQuery, UserListResponse } from "@eyadex/contracts/user-admin";
import type { MembershipUserView } from "@eyadex/contracts/users";
import type { Database, Tx } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";

import { decodeCursor, encodeCursor, iso, likePattern } from "./page-cursor.ts";

interface UserRow {
  id: string;
  user_id: string;
  clinic_id: string;
  full_name: string;
  email: string;
  role_id: string;
  all_branches: boolean;
  status: MembershipUserView["status"];
  preferred_language: MembershipUserView["preferredLanguage"];
  last_login_at: Date | string | null;
  created_at: Date | string;
  role_name_ar: string;
  role_name_en: string;
  branch_ids: string[] | null;
}

const SELECT = sql`SELECT m.id, m.user_id, m.clinic_id, m.full_name, m.email, m.role_id,
    m.all_branches, m.status, m.preferred_language, m.last_login_at, m.created_at,
    r.name_ar AS role_name_ar, r.name_en AS role_name_en,
    (SELECT array_agg(mb.branch_id::text ORDER BY mb.branch_id) FROM membership_branches mb
      WHERE mb.clinic_id = m.clinic_id AND mb.membership_id = m.id) AS branch_ids
  FROM memberships m JOIN roles r ON r.clinic_id = m.clinic_id AND r.id = m.role_id`;

// Exactly the declared fields of membershipUserViewSchema, nothing else.
const toView = (row: UserRow): MembershipUserView => ({
  id: row.id,
  userId: row.user_id,
  clinicId: row.clinic_id,
  fullName: row.full_name,
  email: row.email,
  roleId: row.role_id,
  allBranches: row.all_branches,
  branchIds: row.branch_ids ?? [],
  status: row.status,
  preferredLanguage: row.preferred_language,
  lastLoginAt: row.last_login_at === null ? null : iso(row.last_login_at),
  createdAt: iso(row.created_at),
  roleNameAr: row.role_name_ar,
  roleNameEn: row.role_name_en,
});

/**
 * عضو واحد بشكل الرد، جوه transaction المنادي.
 *
 * @param tx الـ transaction جوه `withTenant`
 * @param clinicId العيادة
 * @param id العضوية
 * @returns العضو أو `null`
 */
export async function findUserView(
  tx: Tx,
  clinicId: string,
  id: string,
): Promise<MembershipUserView | null> {
  const rows = await tx.execute<UserRow>(
    sql`${SELECT} WHERE m.clinic_id = ${clinicId} AND m.id = ${id}`,
  );
  return rows[0] === undefined ? null : toView(rows[0]);
}

/**
 * أعضاء العيادة بـ cursor (story 38): فلتر بالدور والفرع والحالة، وبحث بالاسم أو الإيميل.
 * فلتر الفرع بيشمل أعضاء "كل الفروع". الـ total في جملة لوحده بنفس الفلاتر.
 *
 * @param db الـ pool على `eyadex_app`
 * @param clinicId عيادة السياق
 * @param query الفلاتر والـ cursor
 * @returns الصفحة
 */
export async function listUsers(
  db: Database,
  clinicId: string,
  query: UserListHttpQuery,
): Promise<UserListResponse> {
  const after = decodeCursor(query.cursor);
  const pattern = likePattern(query.search);
  const role = query.roleId ?? null;
  const branch = query.branchId ?? null;
  const status = query.status ?? null;
  const filters: SQL = sql`m.clinic_id = ${clinicId}
    AND (${role}::uuid IS NULL OR m.role_id = ${role}::uuid)
    AND (${status}::text IS NULL OR m.status = ${status}::text)
    AND (${pattern}::text IS NULL OR m.full_name ILIKE ${pattern}::text OR m.email ILIKE ${pattern}::text)
    AND (${branch}::uuid IS NULL OR m.all_branches OR EXISTS (
          SELECT 1 FROM membership_branches fb WHERE fb.clinic_id = m.clinic_id
            AND fb.membership_id = m.id AND fb.branch_id = ${branch}::uuid))`;
  const { rows, total } = await db.withTenant(clinicId, async (tx) => ({
    rows: await tx.execute<UserRow>(
      sql`${SELECT} WHERE ${filters} AND (${after}::uuid IS NULL OR m.id > ${after}::uuid)
          ORDER BY m.id LIMIT ${query.limit + 1}`,
    ),
    total: await tx.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM memberships m WHERE ${filters}`,
    ),
  }));
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toView),
    nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last.id) : null,
    total: Number(total[0]?.total ?? 0),
  };
}
