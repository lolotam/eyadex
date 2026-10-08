import { auditCategorySchema } from "@eyadex/contracts/audit";
import {
  clinicAuditListResponseSchema,
  type ClinicAuditListResponse,
  type ClinicAuditQuery,
} from "@eyadex/contracts/audit-http";
import { clinicAuditEntitySchema } from "@eyadex/contracts/organization";
import type { Database } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { auditSnapshots } from "../domain/audit-snapshot.ts";
import type { ClinicAuditScope } from "../ports/audit-readers.ts";
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
  actor_name: string;
  action: string;
  category: string;
  entity: string;
  entity_id: string | null;
  details: string;
}

/**
 * سجل العيادة بـ cursor (الأحدث الأول)، جوه `withTenant` فالـ RLS بيقصره على عيادة السياق. صفوف
 * الوصول للمراجعين بتتشال لو القارئ مش مسموح له. الـ total في جملة لوحده بنفس الفلاتر.
 *
 * @param db الـ pool على `eyadex_app`
 * @param scope العيادة وهل صفوف المراجعين مسموحة
 * @param query الـ cursor والحد والفلاتر
 * @returns الصفحة، متحققة بالعقد الـ strict
 */
export async function listClinicAudit(
  db: Database,
  scope: ClinicAuditScope,
  query: ClinicAuditQuery,
): Promise<ClinicAuditListResponse> {
  // Only the known entity types are read, so a future writer's new type cannot break the strict answer.
  const entities = query.entity === undefined ? clinicAuditEntitySchema.options : [query.entity];
  const conditions = [
    inList(sql`entity`, entities),
    ...sharedConditions(query, sql`(SELECT timezone FROM clinics WHERE id = ${scope.clinicId})`),
  ];
  if (!scope.patientAccess) conditions.push(sql`category = 'administrative'`);
  if (query.category !== undefined) conditions.push(sql`category = ${query.category}`);
  // RLS already limits audit_log and memberships to the clinic; the predicate keeps the plan on the index.
  const entries = sql`(
    SELECT a.id, a.created_at, a.action, a.category, a.entity_id, a.details, a.entity_type,
           COALESCE(m.full_name, ${UNNAMED_ACTOR}) AS actor_name
    FROM audit_log a
    LEFT JOIN memberships m ON m.clinic_id = a.clinic_id AND m.user_id = a.actor_user_id
    WHERE a.clinic_id = ${scope.clinicId}
  ) AS entries`;
  const named = sql`(SELECT *, ${ENTITY_OF_TYPE} AS entity FROM ${entries}) AS named`;
  const cursor = afterCursor(query.cursor, "clinic");
  const { rows, total } = await db.withTenant(scope.clinicId, async (tx) => ({
    rows: await tx.execute<Row>(
      sql`SELECT id, ${INSTANT_TEXT} AS at_key, actor_name, action, category, entity, entity_id,
                 details::text AS details
          FROM ${named}
          WHERE ${where(cursor === null ? conditions : [...conditions, cursor])}
          ORDER BY created_at DESC, id DESC
          LIMIT ${query.limit + 1}`,
    ),
    total: await tx.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM ${named} WHERE ${where(conditions)}`,
    ),
  }));
  const { page, nextCursor } = pageOf(rows, query.limit, (row) => ({
    kind: "clinic",
    at: row.at_key,
    id: row.id,
  }));
  return clinicAuditListResponseSchema.parse({
    items: page.map((row) => {
      const entity = clinicAuditEntitySchema.parse(row.entity);
      return {
        id: row.id,
        at: new Date(row.at_key).toISOString(),
        actorName: shownName(row.actor_name),
        action: row.action,
        entity,
        category: auditCategorySchema.parse(row.category),
        entityId: row.entity_id,
        ...auditSnapshots(entity, parseDetails(row.details)),
      };
    }),
    nextCursor,
    total: Number(total[0]?.total ?? 0),
  });
}
