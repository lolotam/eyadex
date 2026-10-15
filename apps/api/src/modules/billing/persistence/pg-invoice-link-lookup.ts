import type { Database } from "@eyadex/db";
import { sql } from "drizzle-orm";

/** The live link a token hash names: its clinic, invoice and id. */
export interface LiveInvoiceLink {
  readonly clinicId: string;
  readonly invoiceId: string;
  readonly linkId: string;
}

/**
 * Resolves a patient's link before any clinic is known (R2-7): invoice_link_lookup (0062) is SECURITY
 * DEFINER, sees the six lookup columns only and answers live links only.
 *
 * @returns the link, or null for an unknown, expired or revoked one
 */
export async function lookupInvoiceLink(
  db: Database,
  tokenHash: Buffer,
): Promise<LiveInvoiceLink | null> {
  return db.withNoTenant(async (tx) => {
    const [row] = await tx.execute<{ clinic_id: string; invoice_id: string; link_id: string }>(
      sql`SELECT clinic_id, invoice_id, link_id FROM invoice_link_lookup(${tokenHash})`,
    );
    return row === undefined
      ? null
      : { clinicId: row.clinic_id, invoiceId: row.invoice_id, linkId: row.link_id };
  });
}
