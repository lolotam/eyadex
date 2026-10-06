import type { BranchListQuery, BranchListResponse } from "@eyadex/contracts/branches";
import type { Database } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { ApiError } from "../../../shared/errors.ts";
import { BRANCH_COLUMNS, toBranch } from "../persistence/pg-branch-store.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The cursor is the last id seen, base64url-encoded so the client treats it as opaque. */
const encodeCursor = (id: string) => Buffer.from(id).toString("base64url");
function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, "base64url").toString();
  if (!UUID.test(id)) throw new ApiError("validation", [{ path: ["cursor"], code: "invalid" }]);
  return id;
}

// LIKE metacharacters in the search are literal text, not wildcards.
const likePattern = (search: string) => `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * فروع العيادة بـ cursor (ترتيب الـ id = ترتيب الإنشاء)، فلتر بالحالة وبحث في الاسمين.
 * الـ total في جملة لوحده بنفس الفلاتر (زي `/v1/roles`)، فمايقعش لـ 0 في صفحة بعد الآخر.
 *
 * @param db الـ pool على `eyadex_app`
 * @param clinicId عيادة السياق
 * @param query الـ cursor والحد والفلاتر
 * @returns الصفحة
 */
export async function listBranches(
  db: Database,
  clinicId: string,
  query: BranchListQuery,
): Promise<BranchListResponse> {
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  const active = query.status === undefined ? null : query.status === "active";
  const pattern = query.search === undefined ? null : likePattern(query.search);
  const filters = sql`clinic_id = ${clinicId}
      AND (${active}::boolean IS NULL OR is_active = ${active}::boolean)
      AND (${pattern}::text IS NULL OR name_ar ILIKE ${pattern}::text OR name_en ILIKE ${pattern}::text)`;
  const { rows, total } = await db.withTenant(clinicId, async (tx) => ({
    rows: await tx.execute<Parameters<typeof toBranch>[0]>(
      sql`SELECT ${BRANCH_COLUMNS} FROM branches
          WHERE ${filters} AND (${after}::uuid IS NULL OR id > ${after}::uuid)
          ORDER BY id
          LIMIT ${query.limit + 1}`,
    ),
    total: await tx.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM branches WHERE ${filters}`,
    ),
  }));
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toBranch),
    nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last.id) : null,
    total: Number(total[0]?.total ?? 0),
  };
}
