import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { patientScopeFor, searchTerms, type MemberBranches } from "../domain/patient-rules.ts";
import { ownPatientSql, viewSees } from "../queries/own-patients.ts";

/** A file as the medical module reads it (its `MedicalPatientReader` port, ADR-0029). */
export interface MedicalPatientRow {
  readonly id: string;
  readonly fullName: string;
  readonly fileNumber: number;
  readonly registrationBranchId: string;
  readonly active: boolean;
}

interface Raw {
  id: string;
  full_name: string;
  file_number: string;
  registration_branch_id: string;
  status: "active" | "archived";
}

const toRow = (r: Raw): MedicalPatientRow => ({
  id: r.id,
  fullName: r.full_name,
  fileNumber: Number(r.file_number),
  registrationBranchId: r.registration_branch_id,
  active: r.status === "active",
});

const COLUMNS = sql`id, full_name, file_number, registration_branch_id, status`;
const WALK_IN_LIMIT = 20;

/**
 * The patients module's adapter for the medical module's `MedicalPatientReader` port: the name, file
 * number, registration branch and status only — never the phone, birth date or civil ID — inside the
 * medical transaction, so the medical module never names the patients table and `own` stays one
 * predicate (`own-patients.ts`).
 */
export class PgMedicalPatients {
  async find(tx: Tx, clinicId: string, patientId: string): Promise<MedicalPatientRow | null> {
    const rows = await tx.execute<Raw>(
      sql`SELECT ${COLUMNS} FROM patients WHERE clinic_id = ${clinicId} AND id = ${patientId}`,
    );
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  // ADR-0027: a patient row after the membership row and before the branch row.
  async lockForVisit(
    tx: Tx,
    clinicId: string,
    patientId: string,
  ): Promise<MedicalPatientRow | null> {
    const rows = await tx.execute<Raw>(
      sql`SELECT ${COLUMNS} FROM patients
          WHERE clinic_id = ${clinicId} AND id = ${patientId} FOR SHARE`,
    );
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  async labels(
    tx: Tx,
    clinicId: string,
    patientIds: readonly string[],
  ): Promise<ReadonlyMap<string, MedicalPatientRow>> {
    const unique = [...new Set(patientIds)];
    if (unique.length === 0) return new Map();
    const rows = await tx.execute<Raw>(
      sql`SELECT ${COLUMNS} FROM patients WHERE clinic_id = ${clinicId}
          AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(unique)}::jsonb))`,
    );
    return new Map(rows.map((r) => [r.id, toRow(r)]));
  }

  // Owner decision 2026-10-11: medical content stays inside the patients view reach, judged by this
  // module's own rule for `GET /patients/:id` (`patientScopeFor` + `viewSees`), never a copy of it.
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

  // R3-1: by name or file number only. A phone or civil ID match would tie a number the caller typed
  // to a name it may not otherwise see.
  async walkInCandidates(
    tx: Tx,
    clinicId: string,
    branchId: string,
    q: string,
  ): Promise<readonly { patientId: string; fullName: string; fileNumber: number }[]> {
    const { namePattern, digitsPattern } = searchTerms(q);
    const rows = await tx.execute<Raw>(
      sql`SELECT ${COLUMNS} FROM patients p
          WHERE p.clinic_id = ${clinicId} AND p.registration_branch_id = ${branchId}
            AND p.status = 'active'
            AND (p.full_name ILIKE ${namePattern}::text
              OR (${digitsPattern}::text IS NOT NULL
                AND repeat('0', greatest(0, 6 - length(p.file_number))) || p.file_number
                  LIKE ${digitsPattern}::text))
          ORDER BY p.full_name, p.file_number::bigint
          LIMIT ${WALK_IN_LIMIT}`,
    );
    return rows.map((r) => ({
      patientId: r.id,
      fullName: r.full_name,
      fileNumber: Number(r.file_number),
    }));
  }
}
