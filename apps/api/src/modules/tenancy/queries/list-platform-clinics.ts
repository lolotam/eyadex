import type { Specialty } from "@eyadex/contracts/clinics";
import type {
  PlatformClinicDetail,
  PlatformClinicListQuery,
  PlatformClinicListResponse,
} from "@eyadex/contracts/platform-clinics";
import type { Database } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { ApiError } from "../../../shared/errors.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The cursor is the last (created_at, id) seen, base64url-encoded so the client treats it as opaque. */
const encodeCursor = (createdAt: string, id: string) =>
  Buffer.from(`${createdAt}|${id}`).toString("base64url");

function decodeCursor(cursor: string | undefined): { createdAt: string; id: string } | null {
  if (cursor === undefined) return null;
  const [createdAt = "", id = "", ...rest] = Buffer.from(cursor, "base64url").toString().split("|");
  if (rest.length > 0 || !UUID.test(id) || Number.isNaN(Date.parse(createdAt))) {
    throw new ApiError("validation", [{ path: ["cursor"], code: "invalid" }]);
  }
  return { createdAt: new Date(createdAt).toISOString(), id };
}

// LIKE metacharacters in the search are literal text, not wildcards.
const likePattern = (search: string | undefined) =>
  search === undefined ? null : `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** يقرا تفاصيل عيادة واحدة على pool المنصة؛ `null` = مش موجودة. */
export type PlatformClinicDetailReader = (clinicId: string) => Promise<PlatformClinicDetail | null>;

/**
 * قايمة العيادات للمنصة (story 18، ADR-0016): الأحدث الأول (`created_at desc, id desc`) بـ cursor
 * ثابت حتى لو اتنين ليهم نفس `created_at`. كل عنصر هو نفس شكل التفاصيل — مفيش أي بيانات مراجعين.
 * الـ total في جملة لوحده بنفس الفلاتر.
 *
 * @param db الـ pool على `eyadex_platform` (الـ policy بتاعته بتشوف كل العيادات)
 * @param detail قارئ التفاصيل لكل عيادة في سياقها
 * @param query الـ cursor والحد والفلاتر
 * @returns الصفحة
 */
export async function listPlatformClinics(
  db: Database,
  detail: PlatformClinicDetailReader,
  query: PlatformClinicListQuery,
): Promise<PlatformClinicListResponse> {
  const after = decodeCursor(query.cursor);
  const pattern = likePattern(query.search);
  const status = query.status ?? null;
  const specialty: Specialty | null = query.specialty ?? null;
  const filters = sql`(${status}::text IS NULL OR status = ${status}::text)
      AND (${specialty}::text IS NULL OR specialty = ${specialty}::text)
      AND (${pattern}::text IS NULL OR name_ar ILIKE ${pattern}::text
           OR name_en ILIKE ${pattern}::text OR slug ILIKE ${pattern}::text)`;
  const { rows, total } = await db.withNoTenant(async (tx) => ({
    rows: await tx.execute<{ id: string; created_at: Date | string }>(
      sql`SELECT id, created_at FROM clinics
          WHERE ${filters}
            AND (${after?.createdAt ?? null}::timestamptz IS NULL
                 OR (created_at, id) < (${after?.createdAt ?? null}::timestamptz, ${after?.id ?? null}::uuid))
          ORDER BY created_at DESC, id DESC
          LIMIT ${query.limit + 1}`,
    ),
    total: await tx.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM clinics WHERE ${filters}`,
    ),
  }));
  const page = rows.slice(0, query.limit);
  const items: PlatformClinicDetail[] = [];
  // One read per clinic, each in its own clinic context (branches and features are under RLS).
  for (const row of page) {
    const item = await detail(row.id);
    if (item !== null) items.push(item);
  }
  const last = page.at(-1);
  return {
    items,
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? encodeCursor(new Date(last.created_at).toISOString(), last.id)
        : null,
    total: Number(total[0]?.total ?? 0),
  };
}
