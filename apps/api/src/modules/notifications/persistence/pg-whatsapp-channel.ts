import type { WhatsappStatus, WhatsappTransport } from "@eyadex/contracts/whatsapp";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import { templatesOf, type ChannelRecord } from "../domain/whatsapp-rules.ts";

// The clinic's WhatsApp channel (0057): one row per clinic. Every statement runs inside the caller's
// withTenant(clinicId) transaction and filters on clinic_id itself: RLS and the explicit predicate are
// two independent layers. `next_send_at` is the worker's pace: the API never writes it.

interface ChannelRow {
  id: string;
  transport: WhatsappTransport | null;
  status: WhatsappStatus;
  instance_name: string | null;
  phone_last4: string | null;
  risk_accepted_at: string | Date | null;
  risk_accepted_by: string | null;
  risk_version: number | null;
  sealed_credentials: string | null;
  phone_number_id: string | null;
  business_account_id: string | null;
  templates: unknown;
  connected_at: string | Date | null;
  last_error: string | null;
}

const date = (value: string | Date | null) => (value === null ? null : new Date(value));

/**
 * The clinic's channel, or null when it never linked one. A plain read (no lock): the booking and
 * settings transactions call it without adding a step to the lock order (ADR-0027).
 */
export async function findWhatsappChannel(tx: Tx, clinicId: string): Promise<ChannelRecord | null> {
  const rows = await tx.execute<ChannelRow>(
    sql`SELECT id, transport, status, instance_name, phone_last4, risk_accepted_at, risk_accepted_by,
               risk_version, sealed_credentials, phone_number_id, business_account_id, templates,
               connected_at, last_error
        FROM clinic_whatsapp_channels WHERE clinic_id = ${clinicId}`,
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    transport: row.transport,
    status: row.status,
    instanceName: row.instance_name,
    phoneLast4: row.phone_last4,
    riskAcceptedAt: date(row.risk_accepted_at),
    riskAcceptedBy: row.risk_accepted_by,
    riskVersion: row.risk_version,
    sealedCredentials: row.sealed_credentials,
    phoneNumberId: row.phone_number_id,
    businessAccountId: row.business_account_id,
    templates: templatesOf(row.templates),
    connectedAt: date(row.connected_at),
    lastError: row.last_error,
  };
}

/** Whether the clinic's channel is `connected` now (a plain read, for queueing and the settings rule). */
export async function whatsappConnected(tx: Tx, clinicId: string): Promise<boolean> {
  const rows = await tx.execute<{ connected: boolean }>(
    sql`SELECT status = 'connected' AS connected
        FROM clinic_whatsapp_channels WHERE clinic_id = ${clinicId}`,
  );
  return rows[0]?.connected === true;
}

/**
 * Serialises the API's writes to one clinic's channel (link, unlink, coexistence), so each decides on
 * the row it replaces. Taken alone: no other lock is held with it.
 */
export async function lockWhatsappChannel(tx: Tx, clinicId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp_channel:${clinicId}`}, 0))`,
  );
}

/**
 * Writes the clinic's one row whole (inserted with `record.id` the first time, replaced after that).
 * The caller holds `lockWhatsappChannel`; the pace column keeps its value.
 */
export async function saveWhatsappChannel(
  tx: Tx,
  clinicId: string,
  record: ChannelRecord,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  await tx.execute(
    sql`INSERT INTO clinic_whatsapp_channels (clinic_id, id, transport, status, instance_name,
          phone_last4, risk_accepted_at, risk_accepted_by, risk_version, sealed_credentials,
          phone_number_id, business_account_id, templates, connected_at, last_error, created_at,
          updated_at)
        VALUES (${clinicId}, ${record.id}, ${record.transport}, ${record.status},
          ${record.instanceName}, ${record.phoneLast4}, ${iso(record.riskAcceptedAt)}::timestamptz,
          ${record.riskAcceptedBy}, ${record.riskVersion}, ${record.sealedCredentials},
          ${record.phoneNumberId}, ${record.businessAccountId},
          ${JSON.stringify(record.templates)}::jsonb, ${iso(record.connectedAt)}::timestamptz,
          ${record.lastError}, ${at}::timestamptz, ${at}::timestamptz)
        ON CONFLICT ON CONSTRAINT clinic_whatsapp_channels_one_per_clinic DO UPDATE SET
          transport = EXCLUDED.transport, status = EXCLUDED.status,
          instance_name = EXCLUDED.instance_name, phone_last4 = EXCLUDED.phone_last4,
          risk_accepted_at = EXCLUDED.risk_accepted_at, risk_accepted_by = EXCLUDED.risk_accepted_by,
          risk_version = EXCLUDED.risk_version, sealed_credentials = EXCLUDED.sealed_credentials,
          phone_number_id = EXCLUDED.phone_number_id,
          business_account_id = EXCLUDED.business_account_id, templates = EXCLUDED.templates,
          connected_at = EXCLUDED.connected_at, last_error = EXCLUDED.last_error,
          updated_at = EXCLUDED.updated_at`,
  );
}
