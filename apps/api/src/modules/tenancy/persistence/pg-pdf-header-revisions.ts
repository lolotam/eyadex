import { sql, type Tx } from "@eyadex/db";

/** قفل العرض بترتيب الفرع ثم العيادة؛ لا وصول لبيانات المراجع. */
export class PgPdfHeaderRevisions {
  async read(tx: Tx, clinicId: string, branchId: string) {
    const [branch] = await tx.execute<{ revision: string }>(sql`
      SELECT pdf_display_revision::text AS revision FROM branches
      WHERE clinic_id=${clinicId} AND id=${branchId} FOR SHARE`);
    if (!branch) return null;
    const [clinic] = await tx.execute<{ revision: string }>(sql`
      SELECT pdf_display_revision::text AS revision FROM clinics
      WHERE id=${clinicId} FOR SHARE`);
    return clinic ? { clinic: clinic.revision, branch: branch.revision } : null;
  }
}
