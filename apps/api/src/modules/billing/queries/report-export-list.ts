import { sql, type Tx } from "@eyadex/db";
import {
  reportExportListResponseSchema,
  type ReportExportListQuery,
} from "@eyadex/contracts/finance-reports";

/** Requester-scoped, stable cursor ordering; no params, patient ids or storage key selected. */
export async function reportExportList(
  tx: Tx,
  clinicId: string,
  membershipId: string,
  query: ReportExportListQuery,
) {
  const cursor =
    query.cursor === undefined
      ? sql``
      : sql`AND (created_at, id) < (
    SELECT created_at, id FROM finance_report_exports WHERE clinic_id = ${clinicId}
      AND requested_by = ${membershipId} AND id = ${query.cursor})`;
  const rows = await tx.execute<{
    id: string;
    report: string;
    format: string;
    status: string;
    createdAt: Date | string;
    expiresAt: Date | string | null;
    byteSize: number | null;
    rowCount: number | null;
  }>(sql`SELECT id, report, format, status, created_at AS "createdAt", expires_at AS "expiresAt",
    byte_size AS "byteSize", row_count AS "rowCount" FROM finance_report_exports
    WHERE clinic_id = ${clinicId} AND requested_by = ${membershipId} ${cursor}
    ORDER BY created_at DESC, id DESC LIMIT ${query.limit + 1}`);
  const counts = await tx.execute<{
    total: number;
  }>(sql`SELECT count(*)::int AS total FROM finance_report_exports
    WHERE clinic_id = ${clinicId} AND requested_by = ${membershipId}`);
  const items = rows.slice(0, query.limit).map((row) => ({
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    expiresAt: row.expiresAt === null ? null : new Date(row.expiresAt).toISOString(),
  }));
  return reportExportListResponseSchema.parse({
    items,
    nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    total: counts[0]?.total ?? 0,
  });
}
