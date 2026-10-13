import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/**
 * يفصل Evolution فقط ويرجع هوية الصف المتغير حتى لا يتكرر سجل التدقيق عند إعادة الحدث.
 * @param tx معاملة العيادة
 * @param clinicId هوية العيادة
 * @param at وقت الحدث
 * @returns هويات الصفوف المتغيرة
 */
export async function closeEvolutionChannel(
  tx: Tx,
  clinicId: string,
  at: Date,
): Promise<readonly { id: string }[]> {
  return tx.execute<{ id: string }>(sql`UPDATE clinic_whatsapp_channels
    SET status = 'disconnected', last_error = 'evo_connection_closed', connected_at = NULL,
        updated_at = ${at.toISOString()}::timestamptz
    WHERE clinic_id = ${clinicId} AND transport = 'evolution'
      AND (status <> 'disconnected' OR last_error IS DISTINCT FROM 'evo_connection_closed')
    RETURNING id`);
}
