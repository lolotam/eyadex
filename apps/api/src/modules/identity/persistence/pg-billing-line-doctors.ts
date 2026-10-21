import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/**
 * identity's adapter for the billing module's `BillingLineDoctorLocks` port (spec §8d item 4): the
 * membership rows of the invoice lines' doctors, locked the way the lines' foreign key locks them.
 */
export class PgBillingLineDoctors {
  // ADR-0027 item 6: the membership row comes before the patient row, so the lines' foreign key finds
  // its lock already held and no write waits on a membership while it holds a branch. An id of no
  // member locks nothing here; the line's foreign key still refuses it later, as it does today.
  async lockLineDoctors(tx: Tx, clinicId: string, membershipIds: readonly string[]): Promise<void> {
    const sorted = [...new Set(membershipIds)].sort();
    if (sorted.length === 0) return;
    await tx.execute(
      sql`SELECT id FROM memberships WHERE clinic_id = ${clinicId}
            AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(sorted)}::jsonb))
            ORDER BY id FOR KEY SHARE`,
    );
  }
}
