import type { WhatsappStatus, WhatsappTransport } from "@eyadex/contracts/whatsapp";
import { sql, type Tx } from "@eyadex/db";

import type { WhatsappChannelState } from "../ports/notification-store.ts";

type ChannelRow = {
  id: string;
  transport: WhatsappTransport | null;
  status: WhatsappStatus;
  instance_name: string | null;
  templates: unknown;
  next_send_at: string | null;
};

/**
 * صف قناة واتساب العيادة (0057) `FOR UPDATE SKIP LOCKED`، آخر قفل في ترتيب `PgNotificationStore`. لو
 * إرسال تاني لنفس العيادة ماسكه دلوقتي، مانستناش القفل جوه transaction محدودة الوقت: الصف `busy`
 * والرسالة بتستنى دورها بره. قراءة عادية بعدها بتفرّق بين "ممسوك" و"مفيش صف".
 *
 * @param tx الـ transaction تحت `withTenant`
 * @param clinicId العيادة
 * @returns حالة القناة
 */
export async function lockWhatsappChannel(tx: Tx, clinicId: string): Promise<WhatsappChannelState> {
  const [row] = (await tx.execute(
    sql`SELECT id, transport, status, instance_name, templates,
               to_json(next_send_at) #>> '{}' AS next_send_at
        FROM clinic_whatsapp_channels WHERE clinic_id = ${clinicId}
        FOR UPDATE SKIP LOCKED`,
  )) as unknown as ChannelRow[];
  if (row === undefined) {
    const [exists] = (await tx.execute(
      sql`SELECT 1 AS one FROM clinic_whatsapp_channels WHERE clinic_id = ${clinicId}`,
    )) as unknown as { one: number }[];
    return exists === undefined ? { kind: "none" } : { kind: "busy" };
  }
  return {
    kind: "locked",
    transport: row.transport,
    status: row.status,
    instanceName: row.instance_name,
    templates: row.templates,
    nextSendAt: row.next_send_at === null ? null : new Date(row.next_send_at),
    recordSend: async (next, error, at) => {
      await tx.execute(
        sql`UPDATE clinic_whatsapp_channels
            SET next_send_at = ${next.toISOString()}::timestamptz,
                last_error = ${error === null ? null : error.slice(0, 120)},
                updated_at = ${at.toISOString()}::timestamptz
            WHERE clinic_id = ${clinicId} AND id = ${row.id}`,
      );
    },
  };
}
