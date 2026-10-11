import type { Tx } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";

import { coversBranch, type PatientScope } from "../domain/patient-rules.ts";

// ADR-0026 A3 (CLAUDE.architecture.md §2.2): the one place the patients module names the appointments
// relation, read-only, in one EXISTS predicate. A port implemented by appointments would close an import
// cycle (appointments already binds patients' PgBookingPatients); module-boundaries.spec.ts pins it here.
// P2 (spec §2, ADR-0029): the same predicate names `visits` read-only for the same reason (medical binds
// patients' PgMedicalPatients), so `own` means one thing for patients, visits and clinical content.

/**
 * D-4، spec P2 §2: الملف \`p\` ليه موعد واحد على الأقل مع العضو ده مش ملغي، فات أو جاي، في أي فرع، أو أي
 * زيارة مقدّم خدمتها العضو ده بأي حالة (R1-18: الزيارة المباشرة الملغية برضه بتسجّل مين شاف المراجع).
 * بيقرا الـ partial index بتاع 0043 (\`appointments_clinic_provider_patient_live_idx\`) و
 * \`visits_clinic_provider_patient_idx\` بتاع 0046.
 *
 * @param membershipId عضوية الفاعل
 * @returns الشرط على الـ alias \`p\` (\`patients\`)
 */
export const ownPatientSql = (membershipId: string): SQL =>
  sql`(EXISTS (SELECT 1 FROM appointments a
    WHERE a.clinic_id = p.clinic_id AND a.patient_id = p.id
      AND a.provider_membership_id = ${membershipId}::uuid AND a.status <> 'cancelled')
    OR EXISTS (SELECT 1 FROM visits v
    WHERE v.clinic_id = p.clinic_id AND v.patient_id = p.id
      AND v.provider_membership_id = ${membershipId}::uuid))`;

/**
 * Does the caller's view scope see this file? By its registration branch, or under `own` by a live
 * appointment or any visit with the caller, judged now inside the caller's transaction.
 *
 * @param tx the caller's transaction (inside `withTenant`)
 * @param clinicId the clinic
 * @param view the caller's view scope, or `null`
 * @param file the file's id and registration branch
 * @returns `true` when visible
 */
export async function viewSees(
  tx: Tx,
  clinicId: string,
  view: PatientScope | null,
  file: { readonly id: string; readonly registrationBranchId: string },
): Promise<boolean> {
  if (view === null || !("own" in view)) return coversBranch(view, file.registrationBranchId);
  const rows = await tx.execute<{ own: boolean }>(
    sql`SELECT ${ownPatientSql(view.own)} AS own FROM patients p
        WHERE p.clinic_id = ${clinicId} AND p.id = ${file.id}`,
  );
  return rows[0]?.own === true;
}
