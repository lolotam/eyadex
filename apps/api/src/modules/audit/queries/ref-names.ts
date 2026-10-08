import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { RefIds, RefNames } from "../domain/audit-refs.ts";
import { uuidArray } from "./audit-sql.ts";

type NameRow = { id: string; name_ar: string; name_en: string };

const TABLES = { roles: sql`roles`, branches: sql`branches` } as const;

/**
 * أسماء الأدوار والفروع اللي في لقطات صفحة، جوه transaction العيادة (RLS بيقصرها عليها). على pool
 * المنصة ده بيستخدم بس الـ SELECT اللي عندها أصلاً على `roles` و`branches` (0013).
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param clinicId العيادة
 * @param ids الـ ids المطلوبة
 * @returns الأسماء بالـ id
 */
export async function readRefNames(tx: Tx, clinicId: string, ids: RefIds): Promise<RefNames> {
  const read = async (table: "roles" | "branches", wanted: readonly string[]) => {
    if (wanted.length === 0) return new Map<string, { nameAr: string; nameEn: string }>();
    const rows = await tx.execute<NameRow>(
      sql`SELECT id, name_ar, name_en FROM ${TABLES[table]}
          WHERE clinic_id = ${clinicId} AND id = ANY(${uuidArray(wanted)})`,
    );
    return new Map(rows.map((row) => [row.id, { nameAr: row.name_ar, nameEn: row.name_en }]));
  };
  return { roles: await read("roles", ids.roles), branches: await read("branches", ids.branches) };
}
