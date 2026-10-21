import type { CashClosing, CashClosingListQuery } from "@eyadex/contracts/finance";
import type { Tx } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";

import { ApiError } from "../../../shared/errors.ts";
import type { MemberBranches } from "../domain/billing-actor.ts";
import { CLOSING_COLUMNS, toClosing, type ClosingRaw } from "../persistence/pg-cash-closings.ts";
import { branchCondition } from "./branch-condition.ts";
import { fromCursor, toCursor } from "./list-cursor.ts";

function filters(clinicId: string, query: CashClosingListQuery, reach: MemberBranches): SQL[] {
  const where = [sql`k.clinic_id = ${clinicId}`, branchCondition(reach, sql`k.branch_id`)];
  if (query.branchId !== undefined) where.push(sql`k.branch_id = ${query.branchId}`);
  // A closing's day is the branch's business day in the clinic's timezone (F2-Q9).
  if (query.from !== undefined) where.push(sql`k.business_date >= ${query.from}::date`);
  if (query.to !== undefined) where.push(sql`k.business_date <= ${query.to}::date`);
  return where;
}

/**
 * `GET /v1/cash-closings`: newest first, a page and the total that matches, inside the caller's reach.
 * No patient appears on a closing (spec §4.6).
 *
 * @param reach the branches the caller may read
 * @returns the page, the next cursor and the total
 */
export async function listCashClosings(
  tx: Tx,
  clinicId: string,
  query: CashClosingListQuery,
  reach: MemberBranches,
): Promise<{ items: CashClosing[]; nextCursor: string | null; total: number }> {
  const where = filters(clinicId, query, reach);
  const [count] = await tx.execute<{ total: number }>(
    sql`SELECT count(*)::int AS total FROM cash_closings k WHERE ${sql.join(where, sql` AND `)}`,
  );
  const after = query.cursor === undefined ? null : fromCursor(query.cursor);
  // A cursor this list never made is refused, like every other list, instead of restarting at page one.
  if (query.cursor !== undefined && after === null) {
    throw new ApiError("validation", [{ path: ["cursor"], code: "invalid" }]);
  }
  const page = after === null ? where : [...where, sql`k.id < ${after}::uuid`];
  const rows = await tx.execute<ClosingRaw>(
    sql`SELECT ${CLOSING_COLUMNS} FROM cash_closings k WHERE ${sql.join(page, sql` AND `)}
        ORDER BY k.id DESC LIMIT ${query.limit + 1}`,
  );
  const items = rows.slice(0, query.limit).map(toClosing);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > query.limit && last !== undefined ? toCursor(last.id) : null,
    total: count!.total,
  };
}
