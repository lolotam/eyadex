import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** صف الرابط الأصلي مقفول بعد الفاتورة؛ الحكم على انتهاء الصلاحية يأتي بعد الحصول على القفل. */
export async function shareInvoiceLink(tx: Tx, clinicId: string, linkId: string) {
  const [row] = await tx.execute<{
    id: string;
    clinic_id: string;
    invoice_id: string;
    token_hash: Buffer;
    revoked: boolean;
    expires_at: string;
  }>(sql`SELECT id, clinic_id, invoice_id, token_hash, revoked_at IS NOT NULL AS revoked,
      to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at
    FROM invoice_links WHERE clinic_id = ${clinicId} AND id = ${linkId} FOR SHARE`);
  return row ?? null;
}
