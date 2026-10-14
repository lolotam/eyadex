import type { NotificationStatus } from "@eyadex/contracts/notifications";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import {
  applyDeliveryUpdate,
  type DeliveryTransport,
  type DeliveryUpdate,
} from "../domain/delivery-status.ts";

interface DeliveryRow {
  id: string;
  status: NotificationStatus;
  delivered_at: string | Date | null;
  read_at: string | Date | null;
  last_error: string | null;
}

const date = (value: string | Date | null) => (value === null ? null : new Date(value));
const iso = (value: Date | null) => value?.toISOString() ?? null;

/**
 * The clinic that holds a Meta number on a coexistence channel (0059's SECURITY DEFINER lookup), or null.
 * Called outside any clinic context: Meta's webhook names the number, never the clinic.
 */
export async function whatsappClinicForPhoneNumber(
  tx: Tx,
  phoneNumberId: string,
): Promise<string | null> {
  const rows = await tx.execute<{ clinic_id: string | null }>(
    sql`SELECT whatsapp_clinic_for_phone_number(${phoneNumberId}) AS clinic_id`,
  );
  return rows[0]?.clinic_id ?? null;
}

/**
 * Applies one provider status to the clinic's WhatsApp rows of that transport carrying the provider's
 * message id, under a row lock, with the forward-only rule of `applyDeliveryUpdate`. Runs inside
 * withTenant(clinicId); a replay or an unknown id changes nothing.
 *
 * @returns how many rows changed
 */
export async function applyProviderStatus(
  tx: Tx,
  target: { clinicId: string; transport: DeliveryTransport; messageId: string },
  update: DeliveryUpdate,
  now: Date,
): Promise<number> {
  const rows = await tx.execute<DeliveryRow>(
    sql`SELECT id, status, delivered_at, read_at, last_error FROM patient_notifications
        WHERE clinic_id = ${target.clinicId} AND channel = 'whatsapp' AND route = ${target.transport}
          AND provider_message_id = ${target.messageId}
        FOR UPDATE`,
  );
  let changed = 0;
  for (const row of rows) {
    const next = applyDeliveryUpdate(
      {
        status: row.status,
        deliveredAt: date(row.delivered_at),
        readAt: date(row.read_at),
        lastError: row.last_error,
      },
      target.transport,
      update,
    );
    if (next === null) continue;
    await tx.execute(sql`UPDATE patient_notifications
      SET status = ${next.status}, delivered_at = ${iso(next.deliveredAt)}::timestamptz,
          read_at = ${iso(next.readAt)}::timestamptz, last_error = ${next.lastError},
          updated_at = ${now.toISOString()}::timestamptz
      WHERE clinic_id = ${target.clinicId} AND id = ${row.id}`);
    changed += 1;
  }
  return changed;
}
