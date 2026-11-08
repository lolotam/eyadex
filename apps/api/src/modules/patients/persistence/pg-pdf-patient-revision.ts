import { sql, type Tx } from "@eyadex/db";

/** قراءة مراجعة الاسم؛ القفل يملكه مسار الفاتورة قبل استدعائها. */
export class PgPdfPatientRevision {
  async read(tx: Tx, clinicId: string, patientId: string): Promise<string | null> {
    const [row] = await tx.execute<{ revision: string }>(sql`
      SELECT pdf_display_revision::text AS revision FROM patients
      WHERE clinic_id=${clinicId} AND id=${patientId}`);
    return row?.revision ?? null;
  }
}
