import { sql, type IdGenerator, type Tx } from "@eyadex/db";

import { afterDefinitiveFailure } from "../domain/clinic-failure.ts";
import type {
  ClinicProviderRow,
  ClinicSendOutcome,
  LockedClinicProvider,
} from "../ports/invitation-state-reader.ts";

const DEGRADED = "clinic.mail_provider_degraded";

type Row = {
  id: string;
  kind: "resend" | "smtp";
  from_name: string;
  from_email: string;
  reply_to: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  sealed_credentials: string;
  version: number;
  verified_at: string | null;
  degraded_at: string | null;
  consecutive_failures: number;
};

const toRow = (r: Row): ClinicProviderRow => ({
  id: r.id,
  kind: r.kind,
  fromName: r.from_name,
  fromEmail: r.from_email,
  replyTo: r.reply_to,
  smtpHost: r.smtp_host,
  smtpPort: r.smtp_port,
  smtpUser: r.smtp_user,
  sealedCredentials: r.sealed_credentials,
  version: r.version,
  verifiedAt: r.verified_at === null ? null : new Date(r.verified_at),
  degradedAt: r.degraded_at === null ? null : new Date(r.degraded_at),
  consecutiveFailures: r.consecutive_failures,
});

/** A clinic provider slot (0055): the primary, and the fallback only patient messages use. */
export type ProviderSlot = "primary" | "fallback";

/**
 * Takes one of the clinic's provider rows FOR UPDATE, after the rows the message is about (the test
 * handler takes only this row, so the lock order stays one way). RLS limits it to the event's clinic.
 * Invitations read the primary slot only (spec §8): a fallback row never routes an invitation. A caller
 * that takes both slots takes the primary first.
 */
export async function lockClinicProvider(
  tx: Tx,
  clinicId: string,
  actorUserId: string,
  ids: IdGenerator,
  slot: ProviderSlot = "primary",
): Promise<LockedClinicProvider | null> {
  const rows = (await tx.execute(
    sql`SELECT id, kind, from_name, from_email, reply_to, smtp_host, smtp_port, smtp_user,
               sealed_credentials, version, verified_at::text AS verified_at,
               degraded_at::text AS degraded_at, consecutive_failures
        FROM clinic_mail_providers WHERE clinic_id = ${clinicId} AND slot = ${slot} FOR UPDATE`,
  )) as unknown as Row[];
  if (rows[0] === undefined) return null;
  const row = toRow(rows[0]);
  const record = async (outcome: ClinicSendOutcome): Promise<boolean> => {
    if (outcome.ok) {
      if (row.consecutiveFailures !== 0) {
        await tx.execute(
          sql`UPDATE clinic_mail_providers SET consecutive_failures = 0
              WHERE clinic_id = ${clinicId} AND id = ${row.id}`,
        );
      }
      return false;
    }
    if (!outcome.definitive) return false;
    const step = afterDefinitiveFailure(row.consecutiveFailures);
    const error = outcome.error.slice(0, 120);
    const at = outcome.at.toISOString();
    if (!step.degrade) {
      await tx.execute(
        sql`UPDATE clinic_mail_providers SET consecutive_failures = ${step.failures}, last_error = ${error}
            WHERE clinic_id = ${clinicId} AND id = ${row.id}`,
      );
      return false;
    }
    await tx.execute(
      sql`UPDATE clinic_mail_providers SET consecutive_failures = ${step.failures}, last_error = ${error},
            degraded_at = ${at}::timestamptz
          WHERE clinic_id = ${clinicId} AND id = ${row.id}`,
    );
    // Ids and a short code only: no address, no secret, nothing a clinic typed.
    const details = {
      reason: "consecutive_failures",
      failures: step.failures,
      lastError: error,
      providerVersion: row.version,
    };
    await tx.execute(
      sql`INSERT INTO audit_log (clinic_id, id, actor_user_id, action, category, entity_type,
            entity_id, branch_id, details, created_at)
          VALUES (${clinicId}, ${ids.newId()}, ${actorUserId}, ${DEGRADED}, 'administrative',
            'clinic_mail_provider', ${row.id}, NULL, ${JSON.stringify(details)}::jsonb, ${at}::timestamptz)`,
    );
    return true;
  };
  return { row, record };
}
