import type { Tx } from "@eyadex/db";
import type {
  reportByServiceQuerySchema,
  reportOutstandingQuerySchema,
} from "@eyadex/contracts/finance-reports";
import type { z } from "zod";
import { sql, type SQL } from "drizzle-orm";

import { ApiError } from "../../../shared/errors.ts";
import type { BillingPatientReader } from "../ports/billing-patients.ts";
import { fromCursor, toCursor } from "./list-cursor.ts";

// postgres.js binds text parameters; a JS array would not be a PostgreSQL uuid[] literal.
export const uuidArray = (ids: readonly string[]): SQL =>
  sql`string_to_array(${ids.join(",")}, ',')::uuid[]`;

export type ReportQuery = z.infer<typeof reportByServiceQuerySchema>;
export type ReportPageQuery = z.infer<typeof reportOutstandingQuerySchema>;
export interface ReportContext {
  readonly clinicId: string;
  readonly branchIds: readonly string[];
  readonly language: "ar" | "en";
  readonly branchNames: ReadonlyMap<string, string>;
}

export function branchReportItems<Row extends { branchId: string }>(
  ctx: ReportContext,
  rows: readonly Row[],
): (Row & { branchName: string })[] {
  return rows.map((row) => {
    const branchName = ctx.branchNames.get(row.branchId);
    if (branchName === undefined) throw new ApiError("unknown");
    return { ...row, branchName };
  });
}

// The relation is a billing SELECT with a private rowId, so a discount line and invoice paginate alike.
export async function reportPage<Row extends { rowId: string }>(
  tx: Tx,
  query: ReportPageQuery,
  relation: SQL,
): Promise<{ rows: Row[]; nextCursor: string | null; total: number }> {
  const after = query.cursor === undefined ? null : fromCursor(query.cursor);
  if (query.cursor !== undefined && after === null) {
    throw new ApiError("validation", [{ path: ["cursor"], code: "invalid" }]);
  }
  const [count] = await tx.execute<{ total: number }>(
    sql`SELECT count(*)::int AS total FROM (${relation}) r`,
  );
  const rows = await tx.execute<Row>(sql`SELECT * FROM (${relation}) r
    WHERE ${after === null ? sql`true` : sql`r."rowId" < ${after}::uuid`}
    ORDER BY r."rowId" DESC LIMIT ${query.limit + 1}`);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    rows: page,
    total: count!.total,
    nextCursor: rows.length > query.limit && last ? toCursor(last.rowId) : null,
  };
}

export async function patientReportItems<Row extends { rowId: string; patientId: string }>(
  tx: Tx,
  clinicId: string,
  rows: readonly Row[],
  patients: BillingPatientReader,
): Promise<(Omit<Row, "rowId"> & { patientName: string })[]> {
  const names = await patients.displayNames(
    tx,
    clinicId,
    rows.map((row) => row.patientId),
  );
  return rows.map(({ rowId: _rowId, ...row }) => {
    const patientName = names.get(row.patientId);
    if (patientName === undefined) throw new ApiError("unknown");
    return { ...row, patientName };
  });
}
