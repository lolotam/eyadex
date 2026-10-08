import {
  PLATFORM_AUDIT_TIME_ZONE,
  platformAuditEntitySchema,
  platformAuditSourceSchema,
} from "@eyadex/contracts/audit";
import {
  platformAuditClinicOptionsResponseSchema,
  platformAuditListResponseSchema,
  type PlatformAuditClinicOptionsResponse,
  type PlatformAuditListResponse,
  type PlatformAuditQuery,
} from "@eyadex/contracts/audit-http";
import type { Database } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { auditSnapshots } from "../domain/audit-snapshot.ts";
import {
  afterCursor,
  ENTITY_OF_TYPE,
  inList,
  INSTANT_TEXT,
  pageOf,
  parseDetails,
  sharedConditions,
  shownName,
  UNNAMED_ACTOR,
  where,
} from "./audit-sql.ts";

interface Row {
  id: string;
  at_key: string;
  source: string;
  actor_name: string;
  action: string;
  entity: string;
  entity_id: string | null;
  clinic_id: string | null;
  clinic_key: string;
  name_ar: string | null;
  name_en: string | null;
  details: string;
}

// Platform events have no clinic key; the nil UUID sorts them consistently in the cursor order.
const NO_CLINIC = "00000000-0000-0000-0000-000000000000";

// Platform events name no entity type; it follows from the action, as in the Phase-A mock.
const PLATFORM_EVENT_ENTITY = sql`CASE
    WHEN starts_with(action, 'invitation.') THEN 'invitation'
    WHEN starts_with(action, 'platform_account.') THEN 'platform_account'
    WHEN starts_with(action, 'platform.') THEN 'platform_settings'
    ELSE 'clinic' END`;

// PLAT-01 is the grant, not this query: eyadex_platform cannot read audit_log at all, and the admin
// view (0013) returns administrative non-patient rows only. There is deliberately no category
// condition here — a patient row cannot be filtered out because it can never be read.
const ENTRIES = sql`(
  SELECT 'platform' AS source, id, created_at, actor_user_id, action, clinic_id,
         ${PLATFORM_EVENT_ENTITY} AS entity, clinic_id AS entity_id, details
  FROM platform_audit_log
  UNION ALL
  SELECT 'clinic', id, created_at, actor_user_id, action, clinic_id,
         ${ENTITY_OF_TYPE}, entity_id, details
  FROM platform_clinic_admin_audit
)`;

const NAMED = sql`(
  SELECT e.*, COALESCE(e.clinic_id, ${NO_CLINIC}::uuid) AS clinic_key,
         COALESCE(n.full_name, ${UNNAMED_ACTOR}) AS actor_name, c.name_ar, c.name_en
  FROM ${ENTRIES} e
  LEFT JOIN platform_audit_actors n ON n.user_id = e.actor_user_id
  LEFT JOIN clinics c ON c.id = e.clinic_id
) AS named`;

/**
 * سجل المنصة بـ cursor: أحداث المنصة + الأحداث الإدارية للعيادات، عبر العيادات كلها (من غير
 * عيادة سياق). صفوف المراجعين مش بتوصل هنا أصلاً لأن الدور ماعندوش grant عليها.
 *
 * @param db الـ pool على `eyadex_platform`
 * @param query الـ cursor والحد والفلاتر
 * @returns الصفحة، متحققة بالعقد الـ strict
 */
export async function listPlatformAudit(
  db: Database,
  query: PlatformAuditQuery,
): Promise<PlatformAuditListResponse> {
  const entities = query.entity === undefined ? platformAuditEntitySchema.options : [query.entity];
  const conditions = [
    inList(sql`entity`, entities),
    ...sharedConditions(query, sql`${PLATFORM_AUDIT_TIME_ZONE}`),
  ];
  if (query.source !== undefined) conditions.push(sql`source = ${query.source}`);
  if (query.clinicId !== undefined) conditions.push(sql`clinic_id = ${query.clinicId}::uuid`);
  const cursor = afterCursor(query.cursor, "platform");
  const { rows, total } = await db.withNoTenant(async (tx) => ({
    rows: await tx.execute<Row>(
      sql`SELECT id, ${INSTANT_TEXT} AS at_key, source, actor_name, action, entity, entity_id,
                 clinic_id, clinic_key, name_ar, name_en, details::text AS details
          FROM ${NAMED}
          WHERE ${where(cursor === null ? conditions : [...conditions, cursor])}
          ORDER BY created_at DESC, id DESC, source DESC, clinic_key DESC
          LIMIT ${query.limit + 1}`,
    ),
    total: await tx.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM ${NAMED} WHERE ${where(conditions)}`,
    ),
  }));
  const { page, nextCursor } = pageOf(rows, query.limit, (row) => ({
    kind: "platform",
    at: row.at_key,
    id: row.id,
    source: row.source,
    clinicKey: row.clinic_key,
  }));
  return platformAuditListResponseSchema.parse({
    items: page.map((row) => {
      const entity = platformAuditEntitySchema.parse(row.entity);
      return {
        id: row.id,
        at: new Date(row.at_key).toISOString(),
        actorName: shownName(row.actor_name),
        action: row.action,
        source: platformAuditSourceSchema.parse(row.source),
        entity,
        category: "administrative",
        entityId: row.entity_id,
        clinicId: row.clinic_id,
        clinicNameAr: row.name_ar,
        clinicNameEn: row.name_en,
        ...auditSnapshots(entity, parseDetails(row.details)),
      };
    }),
    nextCursor,
    total: Number(total[0]?.total ?? 0),
  });
}

/**
 * كل العيادات بالاسمين لفلتر العيادة في سجل المنصة (من غير حد للصفحات).
 *
 * @param db الـ pool على `eyadex_platform`
 * @returns العيادات مرتبة بالاسم الإنجليزي
 */
export async function listPlatformAuditClinics(
  db: Database,
): Promise<PlatformAuditClinicOptionsResponse> {
  const rows = await db.withNoTenant((tx) =>
    tx.execute<{ id: string; name_ar: string; name_en: string }>(
      sql`SELECT id, name_ar, name_en FROM clinics ORDER BY name_en, id`,
    ),
  );
  return platformAuditClinicOptionsResponseSchema.parse(
    rows.map((row) => ({ id: row.id, nameAr: row.name_ar, nameEn: row.name_en })),
  );
}
