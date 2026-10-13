import { sql, type Tx } from "@eyadex/db";
import { ServiceUnavailableError } from "../../../shared/errors.ts";

// Four bounded Evolution requests plus the short database transactions fit within this lease.
const OPERATION_MS = 60_000;

/** Decided under the channel advisory lock, before any network request or channel write. */
export async function requireWhatsappOperationFree(
  tx: Tx,
  clinicId: string,
  now: Date,
): Promise<void> {
  const [busy] = await tx.execute(sql`SELECT 1 FROM clinic_whatsapp_channels
    WHERE clinic_id = ${clinicId} AND operation_expires_at > ${now.toISOString()}::timestamptz`);
  if (busy !== undefined) throw new ServiceUnavailableError();
}

/** Reserves the existing row; its update waits for any worker send already holding the row lock. */
export async function reserveWhatsappOperation(
  tx: Tx,
  clinicId: string,
  id: string,
  now: Date,
): Promise<void> {
  await tx.execute(sql`UPDATE clinic_whatsapp_channels SET operation_id = ${id},
    operation_expires_at = ${new Date(now.getTime() + OPERATION_MS).toISOString()}::timestamptz
    WHERE clinic_id = ${clinicId}`);
}

/** A late release can never clear another request's reservation. */
export async function releaseWhatsappOperation(
  tx: Tx,
  clinicId: string,
  id: string,
): Promise<void> {
  await tx.execute(sql`UPDATE clinic_whatsapp_channels
    SET operation_id = NULL, operation_expires_at = NULL
    WHERE clinic_id = ${clinicId} AND operation_id = ${id}`);
}
