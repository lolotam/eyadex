import { sql, type IdGenerator, type Tx } from "@eyadex/db";
import type { ExportFence } from "../ports/export-store.ts";
import { ownPatient } from "./export-report-queries.ts";

/** Pages are bounded by the tenant cursor; no complete patient set is serialized in JS. */
export async function recordExportPatients(
  tx: Tx,
  ids: IdGenerator,
  fence: ExportFence,
  patients: readonly string[],
): Promise<void> {
  if (patients.length === 0) return;
  const values = [...new Set(patients)].map(
    (patient) => sql`(${fence.clinicId}::uuid, ${ids.newId()}::uuid,
    ${fence.exportId}::uuid, ${fence.attempt}, ${patient}::uuid, clock_timestamp())`,
  );
  await tx.execute(sql`INSERT INTO finance_report_export_patients
    (clinic_id, id, export_id, attempt, patient_id, created_at) VALUES ${sql.join(values, sql`, `)}
    ON CONFLICT (clinic_id, export_id, attempt, patient_id) WHERE patient_id IS NOT NULL DO NOTHING`);
}

/** The same transaction commits the captured patients and a marker only after the writer finishes. */
export async function completeExportPatients(
  tx: Tx,
  ids: IdGenerator,
  fence: ExportFence,
): Promise<void> {
  await tx.execute(sql`INSERT INTO finance_report_export_patients
    (clinic_id, id, export_id, attempt, is_complete, created_at)
    VALUES (${fence.clinicId}, ${ids.newId()}, ${fence.exportId}, ${fence.attempt}, true, clock_timestamp())
    ON CONFLICT (clinic_id, export_id, attempt) WHERE is_complete DO NOTHING`);
}

/** Current reach is checked against the captured set, not a newly aggregated finance result. */
export async function ownExportPatientsReachable(
  tx: Tx,
  fence: ExportFence,
  membershipId: string,
): Promise<boolean> {
  const rows = await tx.execute<{ missing: boolean }>(sql`SELECT EXISTS (
    SELECT 1 FROM finance_report_export_patients i WHERE i.clinic_id = ${fence.clinicId}
      AND i.export_id = ${fence.exportId} AND i.attempt = ${fence.attempt} AND i.patient_id IS NOT NULL
      AND NOT ${ownPatient(membershipId)}) AS missing`);
  return rows[0]?.missing === false;
}
