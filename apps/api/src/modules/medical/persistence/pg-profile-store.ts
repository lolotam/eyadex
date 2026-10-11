import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** أقسام الملف الطبي الخمسة (P2-7) بالترتيب، زي `medicalProfileInputSchema`. */
export const PROFILE_SECTIONS = [
  "allergies",
  "chronicConditions",
  "currentMedications",
  "surgicalHistory",
  "familyHistory",
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** The column each section is sealed into (and bound to, ADR-0028). */
export const PROFILE_COLUMN: Readonly<Record<ProfileSection, string>> = {
  allergies: "allergies_enc",
  chronicConditions: "chronic_conditions_enc",
  currentMedications: "current_medications_enc",
  surgicalHistory: "surgical_history_enc",
  familyHistory: "family_history_enc",
};

/** The stored file: its row id, a sealed envelope or `null` per section, who saved it last and when. */
export interface StoredProfile {
  readonly id: string;
  readonly sections: Readonly<Record<ProfileSection, string | null>>;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

interface Raw {
  id: string;
  allergies_enc: string | null;
  chronic_conditions_enc: string | null;
  current_medications_enc: string | null;
  surgical_history_enc: string | null;
  family_history_enc: string | null;
  updated_by: string;
  updated_at: string;
}

/**
 * The patient's medical file, `FOR UPDATE` when `lock` (a save reads the old sections to name the
 * changed ones).
 *
 * @returns the file, or `null` before its first save
 */
export async function findProfile(
  tx: Tx,
  clinicId: string,
  patientId: string,
  lock = false,
): Promise<StoredProfile | null> {
  const rows = await tx.execute<Raw>(
    sql`SELECT id, allergies_enc, chronic_conditions_enc, current_medications_enc,
          surgical_history_enc, family_history_enc, updated_by,
          to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
        FROM patient_medical_profiles WHERE clinic_id = ${clinicId} AND patient_id = ${patientId}
        ${lock ? sql`FOR UPDATE` : sql``}`,
  );
  const r = rows[0];
  if (r === undefined) return null;
  return {
    id: r.id,
    sections: {
      allergies: r.allergies_enc,
      chronicConditions: r.chronic_conditions_enc,
      currentMedications: r.current_medications_enc,
      surgicalHistory: r.surgical_history_enc,
      familyHistory: r.family_history_enc,
    },
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

/**
 * A patient's medical file is written by one transaction at a time (ADR-0029): a first save racing
 * another would otherwise insert two ids, and every section is sealed to its row id. An advisory lock
 * taken first, before any row lock (ADR-0027).
 */
export async function lockProfile(tx: Tx, clinicId: string, patientId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`medical_profile:${clinicId}:${patientId}`}, 0))`,
  );
}

/**
 * Writes all five sections (spec §5: `PUT` replaces the file), under `lockProfile`: a new row on the
 * first save, else the existing row by its id (the one its envelopes are bound to).
 */
export async function saveProfile(
  tx: Tx,
  clinicId: string,
  profile: {
    readonly id: string;
    readonly patientId: string;
    readonly sections: StoredProfile["sections"];
  },
  existing: boolean,
  updatedBy: string,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  const s = profile.sections;
  if (existing) {
    await tx.execute(
      sql`UPDATE patient_medical_profiles SET allergies_enc = ${s.allergies},
            chronic_conditions_enc = ${s.chronicConditions},
            current_medications_enc = ${s.currentMedications},
            surgical_history_enc = ${s.surgicalHistory}, family_history_enc = ${s.familyHistory},
            updated_by = ${updatedBy}, updated_at = ${at}::timestamptz
          WHERE clinic_id = ${clinicId} AND id = ${profile.id}`,
    );
    return;
  }
  await tx.execute(
    sql`INSERT INTO patient_medical_profiles (clinic_id, id, patient_id, allergies_enc,
          chronic_conditions_enc, current_medications_enc, surgical_history_enc, family_history_enc,
          updated_by, created_at, updated_at)
        VALUES (${clinicId}, ${profile.id}, ${profile.patientId}, ${s.allergies},
          ${s.chronicConditions}, ${s.currentMedications}, ${s.surgicalHistory}, ${s.familyHistory},
          ${updatedBy}, ${at}::timestamptz, ${at}::timestamptz)`,
  );
}
