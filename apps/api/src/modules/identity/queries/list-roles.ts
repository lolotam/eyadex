import type { RoleListResponse } from "@eyadex/contracts/access";
import type { Database } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { ApiError } from "../../../shared/errors.ts";
import { roleSummaryColumns, toRoleSummary, type RoleSummaryRow } from "./role-summary.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The cursor is the last id seen, base64url-encoded so the client treats it as opaque. */
export const encodeCursor = (id: string) => Buffer.from(id).toString("base64url");
export function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, "base64url").toString();
  if (!UUID.test(id)) throw new ApiError("validation", [{ path: ["cursor"], code: "invalid" }]);
  return id;
}

/**
 * أدوار العيادة بـ cursor (ترتيب الـ id، UUID v7 = ترتيب الإنشاء)، مع عدد الأعضاء النشطين وكل
 * الأعضاء ومفاتيح الصلاحيات (PRD story 50). كله جوه `withTenant`، فـ RLS بيقصر النتيجة على العيادة دي.
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
  // The total is counted on its own: read off the page rows, it fell to 0 on a page past the last role.
  const { rows, total } = await db.withTenant(clinicId, async (tx) => ({
    rows: await tx.execute<RoleSummaryRow>(
      sql`SELECT ${roleSummaryColumns}
          FROM roles r
          WHERE r.clinic_id = ${clinicId}
            AND (${after}::uuid IS NULL OR r.id > ${after}::uuid)
          ORDER BY r.id
          LIMIT ${query.limit + 1}`,
    ),
    total: await tx.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM roles WHERE clinic_id = ${clinicId}`,
    ),
  }));
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toRoleSummary),
    nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last.id) : null,
    total: Number(total[0]?.total ?? 0),
  };
}
