import { idSchema } from "@eyadex/contracts/common";
import type { ServiceListHttpQuery, ServiceListResponse } from "@eyadex/contracts/services";
import type { Database } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { ApiError } from "../../../shared/errors.ts";
import { SERVICE_COLUMNS, toClinicService } from "../persistence/pg-service-store.ts";

const encode = (id: string) => Buffer.from(id, "utf8").toString("base64url");

function decode(cursor: string | undefined): string | null {
  if (cursor === undefined) return null;
  const id = idSchema.safeParse(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!id.success) throw new ApiError("validation", [{ path: ["cursor"], code: "custom" }]);
  return id.data;
}

/**
 * خدمات العيادة بـ cursor على الـ id (UUID v7 = ترتيب الإنشاء)، بفلتر الحالة. الـ total في جملة لوحده.
 *
 * @param db الـ pool على `eyadex_app`
 * @param clinicId عيادة السياق
 * @param query الفلاتر والـ cursor
 * @returns الصفحة
 */
export async function listServices(
  db: Database,
  clinicId: string,
  query: ServiceListHttpQuery,
): Promise<ServiceListResponse> {
  const after = decode(query.cursor);
  const status = query.status ?? null;
  const filters = sql`clinic_id = ${clinicId} AND (${status}::text IS NULL OR status = ${status}::text)`;
  const { rows, total } = await db.withTenant(clinicId, async (tx) => ({
    rows: await tx.execute<Parameters<typeof toClinicService>[0]>(
      sql`SELECT ${SERVICE_COLUMNS} FROM clinic_services WHERE ${filters}
            AND (${after}::uuid IS NULL OR id > ${after}::uuid)
          ORDER BY id LIMIT ${query.limit + 1}`,
    ),
    total: await tx.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM clinic_services WHERE ${filters}`,
    ),
  }));
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toClinicService),
    nextCursor: rows.length > query.limit && last !== undefined ? encode(last.id) : null,
    total: Number(total[0]?.total ?? 0),
  };
}
