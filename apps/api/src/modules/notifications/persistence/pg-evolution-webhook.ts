import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/**
 * يحتفظ بوقت قبول الرسالة ومسارها عند رفض تسليمها لاحقًا؛ بقية الصفوف لا تتغير.
 * @param tx معاملة العيادة
 * @param update هوية العيادة والرسالة ووقت الحدث
 * @returns اكتمال الكتابة
 */
export async function rejectEvolutionDelivery(
  tx: Tx,
  update: { clinicId: string; messageId: string; at: Date },
): Promise<void> {
  await tx.execute(sql`UPDATE patient_notifications
    SET status = 'failed', last_error = 'evolution:evo_delivery_rejected',
        updated_at = ${update.at.toISOString()}::timestamptz
    WHERE clinic_id = ${update.clinicId} AND channel = 'whatsapp' AND route = 'evolution'
      AND provider_message_id = ${update.messageId} AND status = 'sent'`);
}

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
