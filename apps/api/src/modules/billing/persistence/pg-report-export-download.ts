import { sql, type Tx } from "@eyadex/db";
import type { ReportExportFormat, ReportId } from "@eyadex/contracts/finance-reports";
import type { BillingPatientReader } from "../ports/billing-patients.ts";

export interface DownloadExportRow {
  readonly id: string;
  readonly requested_by: string;
  readonly report: ReportId;
  readonly format: ReportExportFormat;
  readonly status: string;
  readonly scope: "clinic" | "branch" | "own";
  readonly params: unknown;
  readonly storage_key: string | null;
  readonly attempt: number;
  readonly byte_size: number | string | null;
  readonly has_patient_set: boolean;
  readonly unexpired: boolean;
}

/** The database clock keeps subscription checks current after storage I/O and lock waits. */
export async function exportClinicAllowed(tx: Tx, status: string, expiresAt: string) {
  const rows = await tx.execute<{ allowed: boolean }>(sql`SELECT ${status} <> 'suspended'
    AND ${expiresAt}::timestamptz > clock_timestamp() AS allowed`);
  return rows[0]?.allowed === true;
}

/** The requester predicate is in the query, before any key or patient set is returned. */
export async function readDownloadExport(
  tx: Tx,
  clinicId: string,
  membershipId: string,
  id: string,
) {
  const rows =
    await tx.execute<DownloadExportRow>(sql`SELECT id, requested_by, report, format, status,
    scope, params, storage_key, attempt, byte_size,
    CASE WHEN patient_set_mode = 'ledger' THEN EXISTS (SELECT 1 FROM finance_report_export_patients s
      WHERE s.clinic_id = finance_report_exports.clinic_id AND s.export_id = finance_report_exports.id
        AND s.attempt = finance_report_exports.attempt AND s.is_complete)
    ELSE patient_ids IS NOT NULL END AS has_patient_set,
    expires_at > clock_timestamp() AS unexpired
    FROM finance_report_exports WHERE clinic_id = ${clinicId} AND id = ${id} AND requested_by = ${membershipId}`);
  return rows[0] ?? null;
}

/** Uses patients' canonical own predicate; billing does not name patients, visits or appointments. */
export async function ownExportStillReachable(
  tx: Tx,
  clinicId: string,
  membershipId: string,
  row: DownloadExportRow,
  patients: BillingPatientReader,
) {
  const rows = await tx.execute<{
    reachable: boolean;
  }>(sql`SELECT CASE WHEN e.patient_set_mode = 'ledger'
    THEN NOT EXISTS (SELECT 1 FROM finance_report_export_patients s
      WHERE s.clinic_id = e.clinic_id AND s.export_id = e.id AND s.attempt = e.attempt AND s.patient_id IS NOT NULL
        AND NOT ${patients.ownPatientFilter(membershipId, sql`s.patient_id`)})
    ELSE NOT EXISTS (SELECT 1 FROM unnest(e.patient_ids) AS s(patient_id)
      WHERE NOT ${patients.ownPatientFilter(membershipId, sql`s.patient_id`)}) END AS reachable
    FROM finance_report_exports e WHERE e.clinic_id = ${clinicId} AND e.id = ${row.id} AND e.attempt = ${row.attempt}`);
  return rows[0]?.reachable === true;
}

/** Only the already-deleted attempt is purged, in one transaction with its blob marker. */
export async function markExportPurged(
  tx: Tx,
  clinicId: string,
  row: DownloadExportRow,
): Promise<void> {
  const locked =
    await tx.execute(sql`SELECT id FROM finance_report_exports WHERE clinic_id = ${clinicId}
    AND id = ${row.id} AND status = 'done' AND storage_key = ${row.storage_key} AND attempt = ${row.attempt} FOR UPDATE`);
  if (locked.length !== 1) return;
  await tx.execute(sql`UPDATE finance_report_export_blobs SET state = 'deleted', deleted_at = clock_timestamp(),
    updated_at = clock_timestamp() WHERE clinic_id = ${clinicId} AND export_id = ${row.id}
    AND attempt = ${row.attempt} AND state = 'published' AND storage_key = ${row.storage_key}`);
  await tx.execute(sql`UPDATE finance_report_exports SET status = 'purged', storage_key = NULL
    WHERE clinic_id = ${clinicId} AND id = ${row.id} AND attempt = ${row.attempt} AND status = 'done'`);
}
