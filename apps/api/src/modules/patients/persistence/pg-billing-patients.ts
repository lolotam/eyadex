import type { Tx } from "@eyadex/db";
import { sql, type SQL } from "drizzle-orm";

import { patientScopeFor, type MemberBranches } from "../domain/patient-rules.ts";
import { ownPatientSql, viewSees } from "../queries/own-patients.ts";

/**
 * The patients module's adapter for the billing module's `BillingPatientReader` port (finance spec §8
 * rules 8 and 12): the money operations' patient lock and the `own` / view reach, judged by this module's
 * own rules, so billing never names the patients table.
 */
export class PgBillingPatients {
  async displayName(tx: Tx, clinicId: string, patientId: string): Promise<string | null> {
    const [row] = await tx.execute<{ full_name: string }>(
      sql`SELECT full_name FROM patients WHERE clinic_id = ${clinicId} AND id = ${patientId}`,
    );
    return row?.full_name ?? null;
  }

  // Spec §8 rule 8: the patient row after the clinic's finance lock and before any invoice row. This lock
  // mode serialises money operations on one patient, yet leaves the invoice's foreign key free.
  async lockForInvoice(tx: Tx, clinicId: string, patientId: string): Promise<boolean> {
    const rows = await tx.execute<{ id: string }>(
      sql`SELECT id FROM patients WHERE clinic_id = ${clinicId} AND id = ${patientId}
          FOR NO KEY UPDATE`,
    );
    return rows.length > 0;
  }

  // R1-12: the invoice list's `own` filter is the same predicate, over the patient its column names, so
  // `own` keeps one meaning and billing never names the appointments or visits relations.
  ownPatientFilter(membershipId: string, patientIdColumn: SQL): SQL {
    return sql`EXISTS (SELECT 1 FROM patients p WHERE p.id = ${patientIdColumn}
      AND ${ownPatientSql(membershipId)})`;
  }

  // R1-12: `own` is the patients module's one predicate (an appointment or a visit with the caller).
  async access(
    tx: Tx,
    clinicId: string,
    viewer: {
      readonly permissions: readonly string[];
      readonly member: MemberBranches;
      readonly membershipId: string;
    },
    patientId: string,
  ): Promise<{ own: boolean; inPatientReach: boolean }> {
    const rows = await tx.execute<{ registration_branch_id: string; own: boolean }>(
      sql`SELECT registration_branch_id, ${ownPatientSql(viewer.membershipId)} AS own FROM patients p
          WHERE p.clinic_id = ${clinicId} AND p.id = ${patientId}`,
    );
    const row = rows[0];
    if (row === undefined) return { own: false, inPatientReach: false };
    const view = patientScopeFor(viewer.permissions, viewer.member, "view", viewer.membershipId);
    const file = { id: patientId, registrationBranchId: row.registration_branch_id };
    return { own: row.own === true, inPatientReach: await viewSees(tx, clinicId, view, file) };
  }
}
