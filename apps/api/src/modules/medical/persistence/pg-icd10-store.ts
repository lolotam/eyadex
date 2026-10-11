import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/**
 * R2-8: which of these codes exist and are billable (a header row is not a diagnosis).
 *
 * @returns the billable codes among them
 */
export async function billableCodes(
  tx: Tx,
  codes: readonly string[],
): Promise<ReadonlySet<string>> {
  if (codes.length === 0) return new Set();
  const rows = await tx.execute<{ code: string }>(
    sql`SELECT code FROM icd10_codes WHERE billable
          AND code IN (SELECT value FROM jsonb_array_elements_text(${JSON.stringify([...codes])}::jsonb))`,
  );
  return new Set(rows.map((r) => r.code));
}
