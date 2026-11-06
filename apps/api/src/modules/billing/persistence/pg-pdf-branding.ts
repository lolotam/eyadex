import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

export async function readPdfBranding(tx: Tx, clinicId: string) {
  const [row] = await tx.execute<{ commercialRegNo: string | null; logoKey: string | null }>(
    sql`SELECT commercial_reg_no AS "commercialRegNo", logo_blob_key AS "logoKey"
        FROM clinics WHERE id = ${clinicId}`,
  );
  return row ?? null;
}
