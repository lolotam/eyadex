import type {
  BranchOptionListResponse,
  OptionListQuery,
  RoleOptionListResponse,
} from "@eyadex/contracts/role-admin";
import type { Database } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { decodeCursor, encodeCursor } from "./list-roles.ts";

interface OptionRow {
  id: string;
  name_ar: string;
  name_en: string;
  is_active: boolean;
}

type OptionPage = RoleOptionListResponse & BranchOptionListResponse;

// The user editor's pickers (ADR-0017): id, names and status only, so `view:users` is enough and
// neither `view:roles` nor `view:branches` is needed. Inactive rows are listed too: the editor shows
// the names of a member's past role and branches, and the user filter offers them.

async function optionPage(
  db: Database,
  clinicId: string,
  table: "roles" | "branches",
  query: OptionListQuery,
): Promise<OptionPage> {
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  const from = table === "roles" ? sql`roles` : sql`branches`;
  const { rows, total } = await db.withTenant(clinicId, async (tx) => ({
    rows: await tx.execute<OptionRow>(
      sql`SELECT id, name_ar, name_en, is_active FROM ${from}
          WHERE clinic_id = ${clinicId} AND (${after}::uuid IS NULL OR id > ${after}::uuid)
          ORDER BY id LIMIT ${query.limit + 1}`,
    ),
    total: await tx.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM ${from} WHERE clinic_id = ${clinicId}`,
    ),
  }));
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      isActive: row.is_active,
    })),
    nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last.id) : null,
    total: Number(total[0]?.total ?? 0),
  };
}

/**
 * أدوار العيادة كاختيارات لمحرّر المستخدمين (النشطة والمعطّلة)، بـ cursor.
 *
 * @param db الـ pool على `eyadex_app`
 * @param clinicId عيادة السياق
 * @param query الـ cursor والحد
 * @returns الصفحة
 */
export function listRoleOptions(
  db: Database,
  clinicId: string,
  query: OptionListQuery,
): Promise<RoleOptionListResponse> {
  return optionPage(db, clinicId, "roles", query);
}

/**
 * فروع العيادة كاختيارات لمحرّر المستخدمين (النشطة والمعطّلة)، بـ cursor.
 *
 * @param db الـ pool على `eyadex_app`
 * @param clinicId عيادة السياق
 * @param query الـ cursor والحد
 * @returns الصفحة
 */
export function listBranchOptions(
  db: Database,
  clinicId: string,
  query: OptionListQuery,
): Promise<BranchOptionListResponse> {
  return optionPage(db, clinicId, "branches", query);
}
