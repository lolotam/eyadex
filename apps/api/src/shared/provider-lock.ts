import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/**
 * D-13 (ADR-0026 §3): one provider's booking profile, weekly schedule, time off and appointments change
 * one transaction at a time. Its place in the global lock order (ADR-0027): after the clinic's `roles:`,
 * `users:` and `patients:` locks, before any row lock (the membership row, then a patient, then a branch).
 *
 * @param tx the transaction inside `withTenant(clinicId)`
 * @param clinicId the clinic
 * @param membershipId the provider's membership
 * @returns resolves once the lock is held (until the transaction ends)
 */
export async function lockProvider(tx: Tx, clinicId: string, membershipId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`appointments:${clinicId}:${membershipId}`}, 0))`,
  );
}

/**
 * Several providers in one transaction (a reschedule to another provider): de-duplicated and sorted, so
 * two transactions moving appointments between the same providers always take them in the same order
 * (ADR-0027).
 *
 * @param tx the transaction inside `withTenant(clinicId)`
 * @param clinicId the clinic
 * @param membershipIds the providers' memberships
 * @returns resolves once every lock is held
 */
export async function lockProviders(
  tx: Tx,
  clinicId: string,
  membershipIds: readonly string[],
): Promise<void> {
  for (const id of [...new Set(membershipIds)].sort()) await lockProvider(tx, clinicId, id);
}
