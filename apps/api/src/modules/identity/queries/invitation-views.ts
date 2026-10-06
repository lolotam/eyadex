import type { Invitation } from "@eyadex/contracts/invitations";
import type { InvitationListHttpQuery, InvitationListResponse } from "@eyadex/contracts/user-admin";
import type { Database, Tx } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";

import { decodeCursor, encodeCursor, iso, likePattern } from "./page-cursor.ts";

interface InvitationRow {
  id: string;
  clinic_id: string;
  email: string;
  full_name: string;
  role_id: string;
  all_branches: boolean;
  status: "pending" | "accepted" | "cancelled";
  expires_at: Date | string;
  created_at: Date | string;
  invited_by_user_id: string;
  responded_at: Date | string | null;
  role_name_ar: string;
  role_name_en: string;
  branch_ids: string[] | null;
}

// Never token_hash: the column is not even selected.
const SELECT = sql`SELECT i.id, i.clinic_id, i.email, i.full_name, i.role_id, i.all_branches,
    i.status, i.expires_at, i.created_at, i.invited_by_user_id, i.responded_at,
    r.name_ar AS role_name_ar, r.name_en AS role_name_en,
    (SELECT array_agg(ib.branch_id::text ORDER BY ib.branch_id) FROM invitation_branches ib
      WHERE ib.clinic_id = i.clinic_id AND ib.invitation_id = i.id) AS branch_ids
  FROM invitations i JOIN roles r ON r.clinic_id = i.clinic_id AND r.id = i.role_id`;

const toView = (row: InvitationRow, now: Date): Invitation => {
  const expiresAt = iso(row.expires_at);
  const expired = row.status === "pending" && new Date(expiresAt).getTime() <= now.getTime();
  return {
    id: row.id,
    clinicId: row.clinic_id,
    email: row.email,
    fullName: row.full_name,
    roleId: row.role_id,
    allBranches: row.all_branches,
    branchIds: row.branch_ids ?? [],
    status: expired ? "expired" : row.status,
    expiresAt,
    createdAt: iso(row.created_at),
    invitedBy: row.invited_by_user_id,
    respondedAt: row.responded_at === null ? null : iso(row.responded_at),
    roleNameAr: row.role_name_ar,
    roleNameEn: row.role_name_en,
    // The API never hands out the token or the link (ADR-0012); the field stays for the web mock.
    token: null,
  };
};

/**
 * دعوة واحدة بشكل الرد (من غير الرمز ولا الـ hash).
 *
 * @param tx الـ transaction
 * @param clinicId العيادة
 * @param id الدعوة
 * @param now الوقت لحساب "منتهية"
 * @returns الدعوة أو `null`
 */
export async function findInvitationView(
  tx: Tx,
  clinicId: string,
  id: string,
  now: Date,
): Promise<Invitation | null> {
  const rows = await tx.execute<InvitationRow>(
    sql`${SELECT} WHERE i.clinic_id = ${clinicId} AND i.id = ${id}`,
  );
  return rows[0] === undefined ? null : toView(rows[0], now);
}

const statusFilter = (status: InvitationListHttpQuery["status"], now: string): SQL => {
  switch (status) {
    case undefined:
      return sql`i.status = 'pending'`;
    case "pending":
      return sql`i.status = 'pending' AND i.expires_at > ${now}::timestamptz`;
    case "expired":
      return sql`i.status = 'pending' AND i.expires_at <= ${now}::timestamptz`;
    default:
      return sql`i.status = ${status}`;
  }
};

/**
 * دعوات العيادة بـ cursor (story 38). من غير فلتر: pending + منتهية.
 *
 * @param db الـ pool على `eyadex_app`
 * @param clinicId العيادة
 * @param query الفلاتر
 * @param now الوقت من الـ Clock
 * @returns الصفحة
 */
export async function listInvitations(
  db: Database,
  clinicId: string,
  query: InvitationListHttpQuery,
  now: Date,
): Promise<InvitationListResponse> {
  const after = decodeCursor(query.cursor);
  const pattern = likePattern(query.search);
  const filters = sql`i.clinic_id = ${clinicId} AND ${statusFilter(query.status, now.toISOString())}
    AND (${pattern}::text IS NULL OR i.full_name ILIKE ${pattern}::text OR i.email ILIKE ${pattern}::text)`;
  const { rows, total } = await db.withTenant(clinicId, async (tx) => ({
    rows: await tx.execute<InvitationRow>(
      sql`${SELECT} WHERE ${filters} AND (${after}::uuid IS NULL OR i.id > ${after}::uuid)
          ORDER BY i.id LIMIT ${query.limit + 1}`,
    ),
    total: await tx.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM invitations i WHERE ${filters}`,
    ),
  }));
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => toView(row, now)),
    nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last.id) : null,
    total: Number(total[0]?.total ?? 0),
  };
}
