import { sql, type Database } from "@eyadex/db";

import type { ExportAttemptBlobs } from "../ports/export-builder.ts";
import type { ExportFence } from "../ports/export-store.ts";
import { lockExport } from "./export-sql.ts";
import { financeExportKey } from "../domain/export-key.ts";

/** دفتر محاولة واحدة. قفل التصدير دايمًا قبل صف الملف. */
export class PgExportAttemptBlobs implements ExportAttemptBlobs {
  constructor(private readonly db: Database) {}

  /** @inheritdoc */
  async uploadable(fence: ExportFence): Promise<string | null> {
    return this.db.withTenant(fence.clinicId, async (tx) => {
      const row = await lockExport(tx, fence.clinicId, fence.exportId);
      if (
        row?.status !== "running" ||
        Number(row.attempt) !== fence.attempt ||
        row.lease_owner !== fence.leaseOwner ||
        row.lease_live !== true
      )
        return null;
      const key = financeExportKey({ ...fence, extension: row.format });
      const rows = await tx.execute<{
        storage_key: string;
      }>(sql`SELECT storage_key FROM finance_report_export_blobs
        WHERE clinic_id = ${fence.clinicId} AND export_id = ${fence.exportId}
          AND attempt = ${fence.attempt} AND state = 'allocated'`);
      return key !== null && rows[0]?.["storage_key"] === key ? key : null;
    });
  }

  /** @inheritdoc */
  async discardable(fence: ExportFence): Promise<string | null> {
    return this.db.withTenant(fence.clinicId, async (tx) => {
      const row = await lockExport(tx, fence.clinicId, fence.exportId);
      if (row === undefined) return null;
      const key = financeExportKey({ ...fence, extension: row.format });
      const rows = await tx.execute<{
        storage_key: string;
      }>(sql`SELECT storage_key FROM finance_report_export_blobs
        WHERE clinic_id = ${fence.clinicId} AND export_id = ${fence.exportId}
          AND attempt = ${fence.attempt} AND state IN ('allocated', 'uploaded', 'deleted')`);
      return key !== null && rows[0]?.["storage_key"] === key ? key : null;
    });
  }

  /** @inheritdoc */
  async markDeleted(fence: ExportFence): Promise<void> {
    await this.db.withTenant(fence.clinicId, async (tx) => {
      await lockExport(tx, fence.clinicId, fence.exportId);
      await tx.execute(sql`UPDATE finance_report_export_blobs
        SET state = 'deleted', deleted_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE clinic_id = ${fence.clinicId} AND export_id = ${fence.exportId}
          AND attempt = ${fence.attempt} AND state IN ('allocated', 'uploaded')`);
    });
  }
}
