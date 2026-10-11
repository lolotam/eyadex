import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/**
 * ظروف دوا واحد، كل واحد مربوط بصف الدوا وعموده `<field>_enc`. الأربعة بتتكتب دايمًا (فاضية كمان)؛
 * الملاحظة بس ممكن `null`.
 */
export interface SealedPrescriptionItem {
  readonly medicine: string;
  readonly dose: string;
  readonly frequency: string;
  readonly duration: string;
  readonly note: string | null;
}

/** دوا نشط زي ما اتخزّن: معرّف صفه وظروفه. */
export interface StoredPrescriptionItem {
  readonly id: string;
  readonly visitId: string;
  readonly position: number;
  readonly sealed: SealedPrescriptionItem;
}

/**
 * The active prescription items of several visits, in list order (R1-13: archived rows never leave).
 *
 * @returns every active item of those visits
 */
export async function prescriptionOf(
  tx: Tx,
  clinicId: string,
  visitIds: readonly string[],
): Promise<readonly StoredPrescriptionItem[]> {
  if (visitIds.length === 0) return [];
  const rows = await tx.execute<{
    id: string;
    visit_id: string;
    position: number;
    medicine_enc: string;
    dose_enc: string;
    frequency_enc: string;
    duration_enc: string;
    note_enc: string | null;
  }>(
    sql`SELECT id, visit_id, position, medicine_enc, dose_enc, frequency_enc, duration_enc, note_enc
        FROM visit_prescription_items
        WHERE clinic_id = ${clinicId} AND archived_at IS NULL
          AND visit_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify([...visitIds])}::jsonb))
        ORDER BY visit_id, position`,
  );
  return rows.map((r) => ({
    id: r.id,
    visitId: r.visit_id,
    position: Number(r.position),
    sealed: {
      medicine: r.medicine_enc,
      dose: r.dose_enc,
      frequency: r.frequency_enc,
      duration: r.duration_enc,
      note: r.note_enc,
    },
  }));
}

/** R1-13: archives the active items; the caller holds the visit row `FOR UPDATE`. */
export async function archivePrescription(
  tx: Tx,
  clinicId: string,
  visitId: string,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE visit_prescription_items SET archived_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND visit_id = ${visitId} AND archived_at IS NULL`,
  );
}

/** One new item; its envelopes are bound to its own id (ADR-0028). */
export type NewPrescriptionItem = Omit<StoredPrescriptionItem, "visitId">;

/** R1-13: the new list in one statement. */
export async function insertPrescription(
  tx: Tx,
  clinicId: string,
  visitId: string,
  rows: readonly NewPrescriptionItem[],
  now: Date,
): Promise<void> {
  if (rows.length === 0) return;
  const at = now.toISOString();
  const values = rows.map(
    ({ id, position, sealed: s }) => sql`(${clinicId}, ${id}, ${visitId}, ${position},
      ${s.medicine}, ${s.dose}, ${s.frequency}, ${s.duration}, ${s.note}, ${at}::timestamptz)`,
  );
  await tx.execute(
    sql`INSERT INTO visit_prescription_items (clinic_id, id, visit_id, position, medicine_enc,
          dose_enc, frequency_enc, duration_enc, note_enc, created_at)
        VALUES ${sql.join(values, sql`, `)}`,
  );
}
