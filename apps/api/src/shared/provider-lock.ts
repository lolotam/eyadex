import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/**
 * D-13 (ADR-0026 §3): one provider's booking profile, weekly schedule and time off — and from slice A2
 * on, its appointments — change one transaction at a time. A path that also needs the clinic's
 * `roles:` / `users:` locks takes them first.
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
