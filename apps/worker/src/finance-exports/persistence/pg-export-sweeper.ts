import { sql, type Database, type Tx } from "@eyadex/db";
import type { ExportBlobStore } from "../ports/export-builder.ts";
import { financeExportKey } from "../domain/export-key.ts";
import { lockExport } from "./export-sql.ts";

interface Candidate {
  export_id: string;
  attempt: number;
  storage_key: string;
  state: string;
}

const due = sql`(
  (b.state = 'deleted' AND b.deleted_at < clock_timestamp() - interval '22 minutes')
  OR (b.state = 'published' AND e.expires_at <= clock_timestamp())
  OR (b.state IN ('allocated', 'uploaded')
    AND NOT (e.status = 'running' AND e.attempt = b.attempt AND e.lease_until > clock_timestamp())
    AND (b.attempt < e.attempt OR b.created_at < clock_timestamp() - interval '16 minutes'))
)`;

/** The bytes are deleted outside every DB transaction. The ledger is updated only afterwards. */
export class PgExportSweeper {
  constructor(
    private readonly db: Database,
    private readonly blobs: ExportBlobStore,
  ) {}

  async sweepClinic(clinicId: string, signal?: AbortSignal): Promise<void> {
    const candidates = await this.db.withTenant(clinicId, (tx) =>
      tx.execute<Candidate>(sql`
      SELECT b.export_id, b.attempt, b.storage_key, b.state FROM finance_report_export_blobs b
      JOIN finance_report_exports e ON e.clinic_id = b.clinic_id AND e.id = b.export_id
      WHERE b.clinic_id = ${clinicId} AND ${due} ORDER BY b.updated_at, b.id LIMIT 50`),
    );
    for (const candidate of candidates) {
      if (signal?.aborted) return;
      const current = await this.db.withTenant(clinicId, (tx) =>
        this.#current(tx, clinicId, candidate),
      );
      if (current === null) continue;
      await this.blobs.delete(current.storage_key);
      if (signal?.aborted) return;
      const gone = current.state === "deleted" && !(await this.blobs.exists(current.storage_key));
      if (signal?.aborted) return;
      await this.db.withTenant(clinicId, async (tx) => {
        const still = await this.#current(tx, clinicId, candidate);
        if (still === null || still.state !== current.state) return;
        await tx.execute(sql`UPDATE finance_report_export_blobs SET state = ${gone ? "gone" : "deleted"},
          deleted_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE clinic_id = ${clinicId} AND export_id = ${candidate.export_id} AND attempt = ${candidate.attempt}
            AND state = ${current.state}`);
        if (current.state === "published") await expire(tx, clinicId, candidate.export_id);
      });
    }
    // Purged exports retain patient ids only until their original expiry, including missing blob rows.
    await this.db.withTenant(clinicId, async (tx) => {
      await tx.execute(sql`UPDATE finance_report_exports SET patient_ids = NULL
        WHERE clinic_id = ${clinicId} AND id IN (
          SELECT id FROM finance_report_exports WHERE clinic_id = ${clinicId}
            AND status IN ('purged', 'expired') AND expires_at <= clock_timestamp()
            AND patient_ids IS NOT NULL ORDER BY expires_at, id LIMIT 50 FOR UPDATE SKIP LOCKED)`);
    });
    // Redact patient identifiers in bounded SQL pages, including failed/unpublished attempts.
    for (;;) {
      if (signal?.aborted) return;
      const cleared = await this.db.withTenant(clinicId, (tx) =>
        tx.execute(sql`UPDATE finance_report_export_patients
        SET patient_id = NULL, cleared_at = clock_timestamp() WHERE clinic_id = ${clinicId} AND id IN (
          SELECT s.id FROM finance_report_export_patients s
          JOIN finance_report_export_blobs b ON b.clinic_id = s.clinic_id AND b.export_id = s.export_id AND b.attempt = s.attempt
          JOIN finance_report_exports e ON e.clinic_id = s.clinic_id AND e.id = s.export_id
          WHERE s.clinic_id = ${clinicId} AND s.patient_id IS NOT NULL
            AND (e.expires_at <= clock_timestamp() OR (b.state IN ('deleted', 'gone')
              AND NOT (e.status IN ('done', 'purged') AND e.attempt = s.attempt)
              AND NOT (e.status = 'running' AND e.attempt = s.attempt AND e.lease_until > clock_timestamp())))
          ORDER BY s.id LIMIT 500 FOR UPDATE OF s SKIP LOCKED) RETURNING id`),
      );
      if (cleared.length < 500) break;
    }
  }

  async #current(tx: Tx, clinicId: string, candidate: Candidate): Promise<Candidate | null> {
    const row = await lockExport(tx, clinicId, candidate.export_id);
    if (row === undefined) return null;
    const key = financeExportKey({
      clinicId,
      exportId: candidate.export_id,
      attempt: candidate.attempt,
      extension: row.format,
    });
    if (key === null || key !== candidate.storage_key) return null;
    const rows =
      await tx.execute<Candidate>(sql`SELECT b.export_id, b.attempt, b.storage_key, b.state
      FROM finance_report_export_blobs b JOIN finance_report_exports e
        ON e.clinic_id = b.clinic_id AND e.id = b.export_id
      WHERE b.clinic_id = ${clinicId} AND b.export_id = ${candidate.export_id}
        AND b.attempt = ${candidate.attempt} AND b.storage_key = ${key} AND ${due}`);
    return rows[0] ?? null;
  }
}

async function expire(tx: Tx, clinicId: string, exportId: string): Promise<void> {
  await tx.execute(sql`UPDATE finance_report_exports SET
    status = CASE WHEN status = 'purged' THEN 'purged' ELSE 'expired' END,
    storage_key = NULL, patient_ids = NULL
    WHERE clinic_id = ${clinicId} AND id = ${exportId}
      AND status IN ('done', 'purged') AND expires_at <= clock_timestamp()`);
}
