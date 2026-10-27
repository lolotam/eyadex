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
  readonly patient_ids: string[] | null;
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
    scope, params, storage_key, attempt, to_jsonb(patient_ids) AS patient_ids,
    expires_at > clock_timestamp() AS unexpired
    FROM finance_report_exports WHERE clinic_id = ${clinicId} AND id = ${id} AND requested_by = ${membershipId}`);
  return rows[0] ?? null;
}

/** Uses patients' canonical own predicate; billing does not name patients, visits or appointments. */
export async function ownExportStillReachable(
  tx: Tx,
  membershipId: string,
  ids: readonly string[],
  patients: BillingPatientReader,
) {
  const rows = await tx.execute<{ missing: boolean }>(sql`SELECT EXISTS (
    SELECT 1 FROM unnest(string_to_array(${ids.join(",")}, ',')::uuid[]) AS s(patient_id)
    WHERE NOT ${patients.ownPatientFilter(membershipId, sql`s.patient_id`)}) AS missing`);
  return rows[0]?.missing === false;
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
