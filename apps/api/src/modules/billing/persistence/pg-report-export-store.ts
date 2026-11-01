import type { ReportExport, ReportExportStatus, ReportId } from "@eyadex/contracts/finance-reports";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { reportExportLockName } from "../domain/report-export-admission.ts";
import type { QueuedReportExport, ReportExportStore } from "../ports/report-export-store.ts";

const instant = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const whole = (value: number | string | null): number | null =>
  value === null ? null : Number(value);

/** تخزين `finance_report_exports` تحت RLS. مفيش قراءة لجدول موديول تاني. */
export class PgReportExportStore implements ReportExportStore {
  async lockClinic(tx: Tx, clinicId: string): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${reportExportLockName(clinicId)}, 0))`,
    );
  }

  async countQueued(tx: Tx, clinicId: string): Promise<number> {
    const [row] = await tx.execute<{ n: number | string }>(
      sql`SELECT count(*)::int AS n FROM finance_report_exports
          WHERE clinic_id = ${clinicId} AND status = 'queued'`,
    );
    return Number(row?.n ?? 0);
  }

  async memberHasRunning(tx: Tx, clinicId: string, membershipId: string): Promise<boolean> {
    const rows = await tx.execute<{ id: string }>(
      sql`SELECT id FROM finance_report_exports
          WHERE clinic_id = ${clinicId} AND requested_by = ${membershipId} AND status = 'running'
          LIMIT 1`,
    );
    return rows.length > 0;
  }

  async insertQueued(tx: Tx, row: QueuedReportExport): Promise<void> {
    const at = row.createdAt.toISOString();
    await tx.execute(
      sql`INSERT INTO finance_report_exports
            (clinic_id, id, requested_by, report, params, format, scope, patient_ids, status, attempt,
             storage_key, created_at)
          VALUES (${row.clinicId}, ${row.id}, ${row.requestedBy}, ${row.report},
            ${JSON.stringify(row.params)}::jsonb, ${row.format}, ${row.scope}, NULL, 'queued', 0, NULL,
            ${at}::timestamptz)`,
    );
  }

  async readForRequester(
    tx: Tx,
    clinicId: string,
    membershipId: string,
    exportId: string,
  ): Promise<ReportExport | null> {
    const [row] = await tx.execute<{
      id: string;
      report: ReportId;
      format: ReportExport["format"];
      status: ReportExportStatus;
      created_at: Date | string;
      expires_at: Date | string | null;
      byte_size: number | string | null;
      row_count: number | string | null;
    }>(
      sql`SELECT id, report, format, status, created_at, expires_at, byte_size, row_count
          FROM finance_report_exports
          WHERE clinic_id = ${clinicId} AND id = ${exportId} AND requested_by = ${membershipId}`,
    );
    if (row === undefined) return null;
    return {
      id: row.id,
      report: row.report,
      format: row.format,
      status: row.status,
      createdAt: instant(row.created_at),
      expiresAt: row.expires_at === null ? null : instant(row.expires_at),
      byteSize: whole(row.byte_size),
      rowCount: whole(row.row_count),
    };
  }
}
