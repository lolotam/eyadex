import { auditCategorySchema } from "@eyadex/contracts/audit";
import {
  clinicAuditListResponseSchema,
  type ClinicAuditListResponse,
  type ClinicAuditQuery,
} from "@eyadex/contracts/audit-http";
import { clinicAuditEntitySchema } from "@eyadex/contracts/organization";
import type { Database } from "@eyadex/db";
import { scrubAuditText } from "@eyadex/observability";
import { sql } from "drizzle-orm";

import { matchActors } from "../domain/audit-actors.ts";
import { refIdsOf, withRefNames } from "../domain/audit-refs.ts";
import { auditSnapshots } from "../domain/audit-snapshot.ts";
import type { AuditNameReaders, MemberName } from "../ports/audit-name-readers.ts";
import type { ClinicAuditScope } from "../ports/audit-readers.ts";
import {
  actorCondition,
  afterCursor,
  ENTITY_OF_TYPE,
  inList,
  INSTANT_TEXT,
  pageOf,
  parseDetails,
  sharedConditions,
  UNNAMED_ACTOR,
  uuidArray,
  where,
} from "./audit-sql.ts";
import { readRefNames } from "./ref-names.ts";

interface Row {
  id: string;
  at_key: string;
  actor_user_id: string;
  action: string;
  category: string;
  entity: string;
  entity_id: string | null;
  details: string;
}

/**
 * سجل العيادة بـ cursor (الأحدث الأول)، جوه `withTenant` فالـ RLS بيقصره على عيادة السياق. صفوف
 * الوصول للمراجعين بتتشال لو القارئ مش مسموح له. الـ total في جملة لوحده بنفس الفلاتر. أسماء
 * الفاعلين والأدوار والفروع ومنطقة العيادة الزمنية بتتقري من ports السجل في نفس الـ transaction،
 * نداء واحد لكل نوع.
 *
 * @param db الـ pool على `eyadex_app`
 * @param readers قرّاء الأسماء (identity و tenancy بينفّذوهم)
 * @param scope العيادة وهل صفوف المراجعين مسموحة
 * @param query الـ cursor والحد والفلاتر
 * @returns الصفحة، متحققة بالعقد الـ strict
 */
export async function listClinicAudit(
  db: Database,
  readers: AuditNameReaders,
  scope: ClinicAuditScope,
  query: ClinicAuditQuery,
): Promise<ClinicAuditListResponse> {
  // Only the known entity types are read, so a future writer's new type cannot break the strict answer.
  const entities = query.entity === undefined ? clinicAuditEntitySchema.options : [query.entity];
  const cursor = afterCursor(query.cursor, "clinic");
  return db.withTenant(scope.clinicId, async (tx) => {
    // The zone is read only when a day filter needs it; an unseen clinic gives NULL, so no row matches.
    const byDay = query.from !== undefined || query.to !== undefined;
    const timeZone = byDay ? await readers.clinics.timeZoneOf(tx, scope.clinicId) : null;
    const conditions = [
      inList(sql`entity`, entities),
      ...sharedConditions(query, sql`${timeZone}::text`),
    ];
    if (!scope.patientAccess) conditions.push(sql`category = 'administrative'`);
    if (query.category !== undefined) conditions.push(sql`category = ${query.category}`);
    // An actor search needs every member: who matches is decided on the shown names, and "named"
    // (a member of this clinic) on the ids, so the filter and `total` never read a hidden value.
    let members: readonly MemberName[] | null = null;
    let actorNamed = sql`false`;
    if (query.actor !== undefined) {
      members = await readers.members.allOf(tx, scope.clinicId);
      const actors = members.map((m) => ({ userId: m.userId, name: m.fullName }));
      conditions.push(actorCondition(matchActors(query.actor, actors, UNNAMED_ACTOR)));
      actorNamed = sql`a.actor_user_id = ANY(${uuidArray(members.map((m) => m.userId))})`;
    }
    // RLS already limits audit_log to the clinic; the predicate keeps the plan on the index.
    const named = sql`(
      SELECT a.id, a.created_at, a.action, a.category, a.entity_id, a.details, a.actor_user_id,
             ${ENTITY_OF_TYPE} AS entity, ${actorNamed} AS actor_named
      FROM audit_log a
      WHERE a.clinic_id = ${scope.clinicId}
    ) AS named`;
    const rows = await tx.execute<Row>(
      sql`SELECT id, ${INSTANT_TEXT} AS at_key, actor_user_id, action, category, entity, entity_id,
                 details::text AS details
          FROM ${named}
          WHERE ${where(cursor === null ? conditions : [...conditions, cursor])}
          ORDER BY created_at DESC, id DESC
          LIMIT ${query.limit + 1}`,
    );
    const total = await tx.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM ${named} WHERE ${where(conditions)}`,
    );
    const { page, nextCursor } = pageOf(rows, query.limit, (row) => ({
      kind: "clinic",
      at: row.at_key,
      id: row.id,
    }));
    const actorNames =
      members === null
        ? await readers.members.namesOf(
            tx,
            scope.clinicId,
            page.map((row) => row.actor_user_id),
          )
        : new Map(members.map((m) => [m.userId, m.fullName]));
    const items = page.map((row) => {
      const entity = clinicAuditEntitySchema.parse(row.entity);
      return {
        id: row.id,
        at: new Date(row.at_key).toISOString(),
        actorName: scrubAuditText(actorNames.get(row.actor_user_id) ?? UNNAMED_ACTOR),
        action: row.action,
        entity,
        category: auditCategorySchema.parse(row.category),
        entityId: row.entity_id,
        ...auditSnapshots(entity, parseDetails(row.details)),
      };
    });
    const names = await readRefNames(
      tx,
      readers,
      scope.clinicId,
      refIdsOf(items.flatMap((item) => [item.before, item.after])),
    );
    return clinicAuditListResponseSchema.parse({
      items: items.map((item) => ({
        ...item,
        before: withRefNames(item.before, names),
        after: withRefNames(item.after, names),
      })),
      nextCursor,
      total: Number(total[0]?.total ?? 0),
    });
  });
}
