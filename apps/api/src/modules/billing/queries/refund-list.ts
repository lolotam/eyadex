import type { Refund, RefundListQuery } from "@eyadex/contracts/finance";
import type { Tx } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";

import { ApiError } from "../../../shared/errors.ts";
import {
  REFUND_COLUMNS,
  REFUNDS_FROM,
  toRefundRow,
  type RefundRaw,
} from "../persistence/pg-refund-reads.ts";
import type { MemberBranches } from "../domain/billing-actor.ts";
import type { BillingPatientReader } from "../ports/billing-patients.ts";
import { branchCondition } from "./branch-condition.ts";
import { fromCursor, toCursor } from "./list-cursor.ts";

function filters(clinicId: string, query: RefundListQuery, reach: MemberBranches): SQL[] {
  const where = [sql`r.clinic_id = ${clinicId}`, branchCondition(reach, sql`r.branch_id`)];
  if (query.branchId !== undefined) where.push(sql`r.branch_id = ${query.branchId}`);
  if (query.method !== undefined) where.push(sql`r.method = ${query.method}`);
  if (query.patientId !== undefined) where.push(sql`r.patient_id = ${query.patientId}`);
  if (query.invoiceId !== undefined) where.push(sql`r.invoice_id = ${query.invoiceId}`);
  // The days are the clinic's own business days (spec §4.6), already stored in the clinic's timezone.
  if (query.from !== undefined) where.push(sql`r.business_date >= ${query.from}::date`);
  if (query.to !== undefined) where.push(sql`r.business_date <= ${query.to}::date`);
  return where;
}

/**
 * `GET /v1/refunds`: newest first, a page and the total that matches, inside the caller's reach.
 *
 * @param reach the branches the caller may read
 * @returns the page, the next cursor and the total
 */
export async function listRefunds(
  tx: Tx,
  clinicId: string,
  query: RefundListQuery,
  reach: MemberBranches,
  patients: Pick<BillingPatientReader, "displayNames">,
): Promise<{ items: Refund[]; nextCursor: string | null; total: number }> {
  const where = filters(clinicId, query, reach);
  const [count] = await tx.execute<{ total: number }>(
    sql`SELECT count(*)::int AS total ${REFUNDS_FROM} WHERE ${sql.join(where, sql` AND `)}`,
  );
  const after = query.cursor === undefined ? null : fromCursor(query.cursor);
  // A cursor this list never made is refused, like every other list, instead of restarting at page one.
  if (query.cursor !== undefined && after === null) {
    throw new ApiError("validation", [{ path: ["cursor"], code: "invalid" }]);
  }
  const page = after === null ? where : [...where, sql`r.id < ${after}::uuid`];
  const rows = await tx.execute<RefundRaw>(
    sql`SELECT ${REFUND_COLUMNS} ${REFUNDS_FROM} WHERE ${sql.join(page, sql` AND `)}
        ORDER BY r.id DESC LIMIT ${query.limit + 1}`,
  );
  const pageRows = rows.slice(0, query.limit);
  const names = await patients.displayNames(
    tx,
    clinicId,
    pageRows.map((row) => row.patient_id),
  );
  const items = pageRows.map((row) => {
    const name = names.get(row.patient_id);
    if (name === undefined) throw new ApiError("unknown");
    return { ...toRefundRow(row), patientName: name };
  });
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > query.limit && last !== undefined ? toCursor(last.id) : null,
    total: count!.total,
  };
}
