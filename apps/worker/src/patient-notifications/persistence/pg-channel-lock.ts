import { SYSTEM_ACTOR_ID } from "@eyadex/contracts/audit";
import type { WhatsappStatus, WhatsappTransport } from "@eyadex/contracts/whatsapp";
import { sql, type IdGenerator, type Tx } from "@eyadex/db";

import type { WhatsappChannelState } from "../ports/notification-store.ts";

type ChannelRow = {
  id: string;
  sealed_credentials: string | null;
  phone_number_id: string | null;
  transport: WhatsappTransport | null;
  status: WhatsappStatus;
  instance_name: string | null;
  templates: unknown;
  next_send_at: string | null;
  operation_expires_at: string | null;
};

/**
 * صف قناة واتساب العيادة (0057) `FOR UPDATE SKIP LOCKED`، آخر قفل في ترتيب `PgNotificationStore`. لو
 * إرسال تاني لنفس العيادة ماسكه دلوقتي، مانستناش القفل جوه transaction محدودة الوقت: الصف `busy`
 * والرسالة بتستنى دورها بره. قراءة عادية بعدها بتفرّق بين "ممسوك" و"مفيش صف".
 *
 * @param tx الـ transaction تحت `withTenant`
 * @param clinicId العيادة
 * @param ids مولّد معرّف سجل التدقيق
 * @returns حالة القناة
 */
export async function lockWhatsappChannel(
  tx: Tx,
  clinicId: string,
  ids: IdGenerator,
): Promise<WhatsappChannelState> {
  const [row] = (await tx.execute(
    sql`SELECT id, sealed_credentials, phone_number_id, transport, status, instance_name, templates,
               to_json(next_send_at) #>> '{}' AS next_send_at,
               to_json(operation_expires_at) #>> '{}' AS operation_expires_at
        FROM clinic_whatsapp_channels WHERE clinic_id = ${clinicId}
        FOR UPDATE SKIP LOCKED`,
  )) as unknown as ChannelRow[];
  if (row === undefined) {
    const [exists] = (await tx.execute(
      sql`SELECT 1 AS one FROM clinic_whatsapp_channels WHERE clinic_id = ${clinicId}`,
    )) as unknown as { one: number }[];
    return exists === undefined ? { kind: "none" } : { kind: "busy" };
  }
  if (
    row.operation_expires_at !== null &&
    new Date(row.operation_expires_at).getTime() > Date.now()
  )
    return { kind: "busy" };
  return {
    kind: "locked",
    id: row.id,
    sealedCredentials: row.sealed_credentials,
    phoneNumberId: row.phone_number_id,
    transport: row.transport,
    status: row.status,
    instanceName: row.instance_name,
    templates: row.templates,
    nextSendAt: row.next_send_at === null ? null : new Date(row.next_send_at),
    disconnect: async (at) => {
      const changed = await tx.execute(sql`UPDATE clinic_whatsapp_channels
        SET status = 'disconnected', last_error = 'evo_not_connected', connected_at = NULL,
            updated_at = ${at.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${row.id} AND transport = 'evolution'
          AND status <> 'disconnected'
        RETURNING id`);
      if (changed.length === 0) return;
      const details = { transport: "evolution", reason: "send_not_connected" };
      await tx.execute(
        sql`INSERT INTO audit_log (clinic_id, id, actor_user_id, action, category, entity_type,
              entity_id, branch_id, details, created_at)
            VALUES (${clinicId}, ${ids.newId()}, ${SYSTEM_ACTOR_ID}, 'clinic.whatsapp_disconnected',
              'administrative', 'clinic', ${clinicId}, NULL, ${JSON.stringify(details)}::jsonb,
              ${at.toISOString()}::timestamptz)`,
      );
    },
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
