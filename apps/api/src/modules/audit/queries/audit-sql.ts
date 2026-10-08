import { sql, type SQL } from "drizzle-orm";

import type { ActorMatch } from "../domain/audit-actors.ts";
import { decodeAuditCursor, encodeAuditCursor, type AuditCursor } from "../domain/audit-cursor.ts";

/** The name shown for an actor the reader has no name for (a platform account, a system actor). */
export const UNNAMED_ACTOR = "Eyadex";

/** Stored entity type → contract entity: invitation acceptance records the new membership as a user. */
export const ENTITY_OF_TYPE = sql`CASE entity_type WHEN 'membership' THEN 'user' ELSE entity_type END`;

/** The instant at full precision, the cursor's first half. */
export const INSTANT_TEXT = sql`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The filters both lists share, applied to a relation with `created_at` and `action`. */
export interface SharedFilters {
  readonly action?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export function inList(column: SQL, values: readonly string[]): SQL {
  if (values.length === 0) return sql`false`;
  const params = values.map((value) => sql`${value}`);
  return sql`${column} IN (${sql.join(params, sql`, `)})`;
}

/** Any number of ids as one parameter (no per-id placeholder, so no parameter limit). */
export const uuidArray = (ids: readonly string[]): SQL =>
  sql`string_to_array(${ids.join(",")}, ',')::uuid[]`;

/**
 * The actor filter, over ids only. Which actors match was decided on the names as the reader sees
 * them (`matchActors`), so a hidden credential, civil ID or phone digit never decides a row or `total`.
 *
 * @param match the matching named actors, and whether the unnamed label matches
 * @returns the condition, on a relation with `actor_user_id` and `actor_named`
 */
export function actorCondition(match: ActorMatch): SQL {
  return sql`((actor_named AND actor_user_id = ANY(${uuidArray(match.userIds)}))
              OR (${match.unnamed}::boolean AND NOT actor_named))`;
}

/**
 * The conditions for action and the day range. Days are calendar days in `timeZone`, turned into
 * instants in SQL so the index on `created_at` still serves the range.
 *
 * @param filters the parsed query
 * @param timeZone an SQL expression for the IANA zone
 * @returns one condition per filter given
 */
export function sharedConditions(filters: SharedFilters, timeZone: SQL): SQL[] {
  const out: SQL[] = [];
  if (filters.action !== undefined) out.push(sql`action = ${filters.action}`);
  if (filters.from !== undefined) {
    out.push(sql`created_at >= (${filters.from}::date::timestamp AT TIME ZONE ${timeZone})`);
  }
  if (filters.to !== undefined) {
    out.push(sql`created_at < ((${filters.to}::date + 1)::timestamp AT TIME ZONE ${timeZone})`);
  }
  return out;
}

/**
 * The keyset condition after a cursor, or nothing on the first page. The clinic list orders by
 * `created_at DESC, id DESC` (unique inside a clinic); the platform list adds `source` and
 * `clinic_key`, because it merges two tables and many clinics and an id is unique only per clinic.
 *
 * @param raw the opaque cursor from the query
 * @param kind which list
 * @returns the condition, or `null`
 */
export function afterCursor(raw: string | undefined, kind: AuditCursor["kind"]): SQL | null {
  const cursor = decodeAuditCursor(raw, kind);
  if (cursor === null) return null;
  return cursor.kind === "clinic"
    ? sql`(created_at, id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
    : sql`(created_at, id, source, clinic_key)
          < (${cursor.at}::timestamptz, ${cursor.id}::uuid, ${cursor.source}, ${cursor.clinicKey}::uuid)`;
}

export const where = (conditions: readonly SQL[]): SQL =>
  conditions.length === 0 ? sql`true` : sql.join([...conditions], sql` AND `);

/**
 * One page of rows fetched with `limit + 1`, and the cursor after its last row.
 *
 * @param rows the rows, one more than the page when another page follows
 * @param limit the page size
 * @param cursorOf the last row's full sort key
 * @returns the page and `nextCursor`
 */
export function pageOf<R>(rows: readonly R[], limit: number, cursorOf: (row: R) => AuditCursor) {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    page,
    nextCursor:
      rows.length > limit && last !== undefined ? encodeAuditCursor(cursorOf(last)) : null,
  };
}

/** `details` selected as text, so its shape never depends on the driver's jsonb parsing. */
export const parseDetails = (text: string): unknown => JSON.parse(text) as unknown;
