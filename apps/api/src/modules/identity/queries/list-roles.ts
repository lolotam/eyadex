import type { RoleListResponse, RoleSummary } from "@eyadex/contracts/access";
import type { Database } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { ApiError } from "../../../shared/errors.ts";

interface RoleRow {
  id: string;
  system_key: RoleSummary["systemKey"];
  name_ar: string;
  name_en: string;
  is_locked: boolean;
  is_active: boolean;
  active_users: number;
  permission_keys: string[] | null;
  total: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The cursor is the last id seen, base64url-encoded so the client treats it as opaque. */
const encodeCursor = (id: string) => Buffer.from(id).toString("base64url");
function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, "base64url").toString();
  if (!UUID.test(id)) throw new ApiError("validation", [{ path: ["cursor"], code: "invalid" }]);
  return id;
}

/**
 * أدوار العيادة بـ cursor (ترتيب الـ id، UUID v7 = ترتيب الإنشاء)، مع عدد الأعضاء النشطين ومفاتيح
 * الصلاحيات (PRD story 50). كله جوه `withTenant`، فـ RLS بيقصر النتيجة على العيادة دي.
 *
 * @param db الـ pool على `eyadex_app`
 * @param clinicId عيادة السياق
 * @param query الـ cursor والحد
 * @returns الصفحة
 */
export async function listRoles(
  db: Database,
  clinicId: string,
  query: { cursor?: string | undefined; limit: number },
): Promise<RoleListResponse> {
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  const rows = await db.withTenant(clinicId, (tx) =>
    tx.execute<RoleRow>(
      sql`SELECT r.id, r.system_key, r.name_ar, r.name_en, r.is_locked, r.is_active,
                 (SELECT count(*)::int FROM memberships m
                    WHERE m.clinic_id = r.clinic_id AND m.role_id = r.id AND m.status = 'active')
                   AS active_users,
                 (SELECT array_agg(p.key ORDER BY p.key) FROM role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                    WHERE rp.clinic_id = r.clinic_id AND rp.role_id = r.id) AS permission_keys,
                 (SELECT count(*)::int FROM roles t WHERE t.clinic_id = r.clinic_id) AS total
          FROM roles r
          WHERE r.clinic_id = ${clinicId}
            AND (${after}::uuid IS NULL OR r.id > ${after}::uuid)
          ORDER BY r.id
          LIMIT ${query.limit + 1}`,
    ),
  );
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      systemKey: row.system_key,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      isLocked: row.is_locked,
      isActive: row.is_active,
      activeUserCount: Number(row.active_users),
      permissionKeys: row.permission_keys ?? [],
    })),
    nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last.id) : null,
    total: Number(rows[0]?.total ?? 0),
  };
}
