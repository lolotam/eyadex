import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** تشخيص نشط زي ما اتخزّن: معرّف صفه (اللي التشفير مربوط بيه) وظرفين. */
export interface StoredDiagnosis {
  readonly id: string;
  readonly visitId: string;
  readonly position: number;
  readonly kind: "icd10" | "text";
  readonly codeEnc: string | null;
  readonly textEnc: string;
}

const ids = (visitIds: readonly string[]) => JSON.stringify([...visitIds]);

/**
 * The active diagnoses of several visits (a page, a search), in list order. Archived rows never leave
 * this function (R1-13).
 *
 * @returns every active diagnosis of those visits
 */
export async function diagnosesOf(
  tx: Tx,
  clinicId: string,
  visitIds: readonly string[],
): Promise<readonly StoredDiagnosis[]> {
  if (visitIds.length === 0) return [];
  const rows = await tx.execute<{
    id: string;
    visit_id: string;
    position: number;
    kind: "icd10" | "text";
    code_enc: string | null;
    text_enc: string;
  }>(
    sql`SELECT id, visit_id, position, kind, code_enc, text_enc FROM visit_diagnoses
        WHERE clinic_id = ${clinicId} AND archived_at IS NULL
          AND visit_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${ids(visitIds)}::jsonb))
        ORDER BY visit_id, position`,
  );
  return rows.map((r) => ({
    id: r.id,
    visitId: r.visit_id,
    position: Number(r.position),
    kind: r.kind,
    codeEnc: r.code_enc,
    textEnc: r.text_enc,
  }));
}

/**
 * spec §4: signing counts the active diagnoses; a count needs no envelope opened.
 *
 * @returns how many active diagnoses the visit has
 */
export async function activeDiagnosisCount(
  tx: Tx,
  clinicId: string,
  visitId: string,
): Promise<number> {
  const rows = await tx.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM visit_diagnoses
        WHERE clinic_id = ${clinicId} AND visit_id = ${visitId} AND archived_at IS NULL`,
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * R1-13: the replace's first half. The caller holds the visit row `FOR UPDATE`, so no other replace of
 * the same list runs in between.
 */
export async function archiveDiagnoses(
  tx: Tx,
  clinicId: string,
  visitId: string,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE visit_diagnoses SET archived_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND visit_id = ${visitId} AND archived_at IS NULL`,
  );
}

/** One new row; its envelopes are bound to its own id (ADR-0028). */
export type NewDiagnosis = Omit<StoredDiagnosis, "visitId">;

/** R1-13: the replace's second half, the new list in one statement. */
export async function insertDiagnoses(
  tx: Tx,
  clinicId: string,
  visitId: string,
  rows: readonly NewDiagnosis[],
  now: Date,
): Promise<void> {
  if (rows.length === 0) return;
  const at = now.toISOString();
  const values = rows.map(
    (r) => sql`(${clinicId}, ${r.id}, ${visitId}, ${r.position}, ${r.kind}, ${r.codeEnc},
      ${r.textEnc}, ${at}::timestamptz)`,
  );
  await tx.execute(
    sql`INSERT INTO visit_diagnoses (clinic_id, id, visit_id, position, kind, code_enc, text_enc,
          created_at)
        VALUES ${sql.join(values, sql`, `)}`,
  );
}
