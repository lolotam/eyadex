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
import { scrubAuditText } from "@eyadex/observability";
import { sql } from "drizzle-orm";

import { matchActors } from "../domain/audit-actors.ts";
import { refIdsOf, withRefNames, type RefNames } from "../domain/audit-refs.ts";
import { auditSnapshots } from "../domain/audit-snapshot.ts";
import type { AuditNameReaders, BilingualName } from "../ports/audit-name-readers.ts";
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
  where,
} from "./audit-sql.ts";
import { readRefNames } from "./ref-names.ts";

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

// A platform-team event names its account in details.accountId (ADR-0020); the rest name the clinic.
const PLATFORM_EVENT_ENTITY_ID = sql`CASE
    WHEN starts_with(action, 'platform_account.') THEN (details ->> 'accountId')::uuid
    ELSE clinic_id END`;

// PLAT-01 is the grant, not this query: eyadex_platform cannot read audit_log at all, and the admin
// view (0013) returns administrative non-patient rows only. There is deliberately no category
// condition here — a patient row cannot be filtered out because it can never be read.
const ENTRIES = sql`(
  SELECT 'platform' AS source, id, created_at, actor_user_id, action, clinic_id,
         ${PLATFORM_EVENT_ENTITY} AS entity, ${PLATFORM_EVENT_ENTITY_ID} AS entity_id, details
  FROM platform_audit_log
  UNION ALL
  SELECT 'clinic', id, created_at, actor_user_id, action, clinic_id,
         ${ENTITY_OF_TYPE}, entity_id, details
  FROM platform_clinic_admin_audit
)`;

const NAMED = sql`(
  SELECT e.*, COALESCE(e.clinic_id, ${NO_CLINIC}::uuid) AS clinic_key,
         n.user_id IS NOT NULL AS actor_named,
         COALESCE(n.full_name, ${UNNAMED_ACTOR}) AS actor_name
  FROM ${ENTRIES} e
  LEFT JOIN platform_audit_actors n ON n.user_id = e.actor_user_id
) AS named`;

/**
 * سجل المنصة بـ cursor: أحداث المنصة + الأحداث الإدارية للعيادات، عبر العيادات كلها (من غير
 * عيادة سياق). صفوف المراجعين مش بتوصل هنا أصلاً لأن الدور ماعندوش grant عليها. أسماء العيادات
 * والأدوار والفروع من ports السجل (tenancy و identity بينفّذوهم)، نداء واحد لكل نوع.
 *
 * @param db الـ pool على `eyadex_platform`
 * @param readers قرّاء الأسماء
 * @param query الـ cursor والحد والفلاتر
 * @returns الصفحة، متحققة بالعقد الـ strict
 */
export async function listPlatformAudit(
  db: Database,
  readers: AuditNameReaders,
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
  const { rows, total, clinicNames } = await db.withNoTenant(async (tx) => {
    if (query.actor !== undefined) {
      // Every name the platform may see; matched as shown, so the filter never reads a hidden value.
      const known = await tx.execute<{ user_id: string; full_name: string }>(
        sql`SELECT user_id, full_name FROM platform_audit_actors`,
      );
      const actors = known.map((a) => ({ userId: a.user_id, name: a.full_name }));
      conditions.push(actorCondition(matchActors(query.actor, actors, UNNAMED_ACTOR)));
    }
    const found = await tx.execute<Row>(
      sql`SELECT id, ${INSTANT_TEXT} AS at_key, source, actor_name, action, entity, entity_id,
                 clinic_id, clinic_key, details::text AS details
          FROM ${NAMED}
          WHERE ${where(cursor === null ? conditions : [...conditions, cursor])}
          ORDER BY created_at DESC, id DESC, source DESC, clinic_key DESC
          LIMIT ${query.limit + 1}`,
    );
    return {
      rows: found,
      total: await tx.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM ${NAMED} WHERE ${where(conditions)}`,
      ),
      clinicNames: await readers.clinics.namesOf(
        tx,
        found.flatMap((row) => (row.clinic_id === null ? [] : [row.clinic_id])),
      ),
    };
  });
  const { page, nextCursor } = pageOf(rows, query.limit, (row) => ({
    kind: "platform",
    at: row.at_key,
    id: row.id,
    source: row.source,
    clinicKey: row.clinic_key,
  }));
  const items = page.map((row) => {
    const entity = platformAuditEntitySchema.parse(row.entity);
    const clinic: BilingualName | undefined =
      row.clinic_id === null ? undefined : clinicNames.get(row.clinic_id);
    return {
      id: row.id,
      at: new Date(row.at_key).toISOString(),
      actorName: scrubAuditText(row.actor_name),
      action: row.action,
      source: platformAuditSourceSchema.parse(row.source),
      entity,
      category: "administrative" as const,
      entityId: row.entity_id,
      clinicId: row.clinic_id,
      clinicNameAr: clinic === undefined ? null : scrubAuditText(clinic.nameAr),
      clinicNameEn: clinic === undefined ? null : scrubAuditText(clinic.nameEn),
      ...auditSnapshots(entity, parseDetails(row.details)),
    };
  });
  return platformAuditListResponseSchema.parse({
    items: await withClinicRefNames(db, readers, items),
    nextCursor,
    total: Number(total[0]?.total ?? 0),
  });
}

type Item = {
  clinicId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

// Role and branch names are clinic rows: the platform reads them one clinic at a time inside that
// clinic's context, with the SELECT it already holds (0013) — never a cross-clinic window for this.
async function withClinicRefNames<T extends Item>(
  db: Database,
  readers: AuditNameReaders,
  items: readonly T[],
): Promise<T[]> {
  const byClinic = new Map<string, RefNames>();
  for (const clinicId of new Set(items.map((item) => item.clinicId))) {
    if (clinicId === null) continue;
    const ids = refIdsOf(
      items.filter((i) => i.clinicId === clinicId).flatMap((i) => [i.before, i.after]),
    );
    if (ids.roles.length + ids.branches.length === 0) continue;
    byClinic.set(
      clinicId,
      await db.withTenant(clinicId, (tx) => readRefNames(tx, readers, clinicId, ids)),
    );
  }
  return items.map((item) => {
    const names = (item.clinicId !== null && byClinic.get(item.clinicId)) || NO_NAMES;
    return {
      ...item,
      before: withRefNames(item.before, names),
      after: withRefNames(item.after, names),
    };
  });
}

const NO_NAMES: RefNames = { roles: new Map(), branches: new Map() };

/**
 * كل العيادات بالاسمين لفلتر العيادة في سجل المنصة (من غير حد للصفحات).
 *
 * @param db الـ pool على `eyadex_platform`
 * @param readers قرّاء الأسماء (العيادات من tenancy)
 * @returns العيادات مرتبة بالاسم الإنجليزي
 */
export async function listPlatformAuditClinics(
  db: Database,
  readers: Pick<AuditNameReaders, "clinics">,
): Promise<PlatformAuditClinicOptionsResponse> {
  const clinics = await db.withNoTenant((tx) => readers.clinics.listOptions(tx));
  return platformAuditClinicOptionsResponseSchema.parse(
    clinics.map((clinic) => ({
      id: clinic.id,
      nameAr: scrubAuditText(clinic.nameAr),
      nameEn: scrubAuditText(clinic.nameEn),
    })),
  );
}
