import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

// SQL on the invoice numbering (0060): the branch's prefix and the gap-free sequence per branch and
// year. Every function runs inside the caller's withTenant(clinicId). The numbering has its own place
// in the lock order (ADR-0027 item 9b), so it lives in its own file.

/**
 * The branch's prefix, or null when it has none (or is no branch of the clinic). Shared row lock after the
 * patient's: a prefix change, which locks the branch row exclusively, waits for the issue, or the reverse.
 */
export async function branchPrefix(
  tx: Tx,
  clinicId: string,
  branchId: string,
): Promise<string | null> {
  const [row] = await tx.execute<{ invoice_prefix: string | null }>(
    sql`SELECT invoice_prefix FROM branches WHERE clinic_id = ${clinicId} AND id = ${branchId}
        FOR SHARE`,
  );
  return row?.invoice_prefix ?? null;
}

/**
 * The next number of the branch and year (R1-8): the row is created if missing, then locked, read and
 * advanced in the issuing transaction, so a failed issue rolls the number back and the sequence stays
 * gap-free.
 *
 * @returns the number this issue takes
 */
export async function takeNumber(
  tx: Tx,
  ids: { newId(): string },
  clinicId: string,
  branchId: string,
  year: number,
  now: Date,
): Promise<number> {
  const at = now.toISOString();
  await tx.execute(
    sql`INSERT INTO invoice_sequences (clinic_id, id, branch_id, year, next_number, created_at, updated_at)
        VALUES (${clinicId}, ${ids.newId()}, ${branchId}, ${year}, 1, ${at}::timestamptz, ${at}::timestamptz)
        ON CONFLICT (clinic_id, branch_id, year) DO NOTHING`,
  );
  const [row] = await tx.execute<{ next_number: number }>(
    sql`SELECT next_number FROM invoice_sequences
        WHERE clinic_id = ${clinicId} AND branch_id = ${branchId} AND year = ${year} FOR UPDATE`,
  );
  await tx.execute(
    sql`UPDATE invoice_sequences SET next_number = next_number + 1, updated_at = ${at}::timestamptz
        WHERE clinic_id = ${clinicId} AND branch_id = ${branchId} AND year = ${year}`,
  );
  return row!.next_number;
}

/** Records the branch's prefix as used, so no other branch of the clinic can ever take it (rule 9). */
export async function recordPrefix(
  tx: Tx,
  ids: { newId(): string },
  clinicId: string,
  branchId: string,
  prefix: string,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`INSERT INTO used_invoice_prefixes (clinic_id, id, prefix, branch_id, created_at)
        VALUES (${clinicId}, ${ids.newId()}, ${prefix}, ${branchId}, ${now.toISOString()}::timestamptz)
        ON CONFLICT (clinic_id, prefix) DO NOTHING`,
  );
}
