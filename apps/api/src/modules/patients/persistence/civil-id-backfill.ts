import type { Database, Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { CivilIdCodec } from "./civil-id-codec.ts";
import { civilIdAssignments, lockClinicPatients } from "./pg-patient-store.ts";

// ADR-0028, R1-5/R1-6: converts the files written before SQL 0045 (plain `civil_id`) to the encrypted
// columns, one clinic at a time, and proves the result before the plain column is dropped. Counts only:
// no number, envelope or index ever leaves these functions.

const BATCH_SIZE = 500;
const CIVIL_ID = /^[0-9]{12}$/;

/** What one clinic's conversion did (or, on a dry run, would do). */
export interface BackfillCounts {
  /** Files converted (dry run: that would be converted). */
  readonly converted: number;
  /** Plain numbers whose index another file of the clinic already holds; left as they are. */
  readonly collisions: number;
}

/** What one clinic's verification found. */
export interface VerifyCounts {
  /** Files that still hold a plain number. */
  readonly plain: number;
  /** Encrypted files checked. */
  readonly encrypted: number;
  /** Encrypted files that do not open, or whose number does not match their index or last four digits. */
  readonly mismatched: number;
}

export interface BackfillDeps {
  /** The `eyadex_app` pool: every statement runs inside `withTenant` under forced RLS. */
  readonly db: Database;
  readonly civilIds: CivilIdCodec;
  /** Rows per transaction (default 500). */
  readonly batchSize?: number;
}

interface PlainRow {
  id: string;
  civil_id: string;
}

// The indexes another file of this clinic already holds, among the ones this batch would write.
async function takenIndexes(
  tx: Tx,
  clinicId: string,
  indexes: readonly string[],
): Promise<ReadonlySet<string>> {
  if (indexes.length === 0) return new Set();
  const rows = await tx.execute<{ civil_id_hmac: string }>(
    sql`SELECT civil_id_hmac FROM patients
        WHERE clinic_id = ${clinicId} AND civil_id_hmac IN
          (SELECT value FROM jsonb_array_elements_text(${JSON.stringify(indexes)}::jsonb))`,
  );
  return new Set(rows.map((row) => row.civil_id_hmac));
}

// One batch in its own transaction. The rows are read only AFTER the clinic's `patients:` lock, and
// FOR UPDATE: an edit or a create of this clinic either committed before (its row is already encrypted,
// or its number is now taken) or waits for this batch, so no write is ever overwritten (R1-5).
async function convertBatch(
  deps: BackfillDeps,
  clinicId: string,
  after: string | null,
  dryRun: boolean,
): Promise<{ counts: BackfillCounts; last: string | null }> {
  const { db, civilIds } = deps;
  return db.withTenant(clinicId, async (tx) => {
    await lockClinicPatients(tx, clinicId);
    const rows = await tx.execute<PlainRow>(
      sql`SELECT id, civil_id FROM patients
          WHERE clinic_id = ${clinicId} AND civil_id IS NOT NULL AND civil_id_enc IS NULL
            AND (${after}::uuid IS NULL OR id > ${after}::uuid)
          ORDER BY id LIMIT ${deps.batchSize ?? BATCH_SIZE} FOR UPDATE`,
    );
    const indexes = rows.map((row) => civilIds.index(clinicId, row.civil_id));
    const taken = await takenIndexes(tx, clinicId, indexes);
    let converted = 0;
    for (const [i, row] of rows.entries()) {
      if (taken.has(indexes[i]!)) continue;
      converted += 1;
      if (dryRun) continue;
      const columns = civilIdAssignments(civilIds.columns(clinicId, row.id, row.civil_id));
      await tx.execute(
        sql`UPDATE patients SET ${columns} WHERE clinic_id = ${clinicId} AND id = ${row.id}`,
      );
    }
    return {
      counts: { converted, collisions: rows.length - converted },
      last: rows.at(-1)?.id ?? null,
    };
  });
}

/**
 * Converts every plain civil ID of one clinic, in batches; safe to re-run (a converted file is skipped).
 *
 * @param deps the app pool and the codec
 * @param clinicId the clinic
 * @param dryRun counts only, writes nothing
 * @returns the counts
 */
export async function backfillClinicCivilIds(
  deps: BackfillDeps,
  clinicId: string,
  dryRun: boolean,
): Promise<BackfillCounts> {
  let converted = 0;
  let collisions = 0;
  let after: string | null = null;
  for (;;) {
    const batch = await convertBatch(deps, clinicId, after, dryRun);
    converted += batch.counts.converted;
    collisions += batch.counts.collisions;
    if (batch.last === null) return { converted, collisions };
    after = batch.last;
  }
}

// One encrypted file is sound when it opens to 12 digits that give back its own index and last four.
function isSound(
  civilIds: CivilIdCodec,
  clinicId: string,
  row: { id: string; civil_id_enc: string; civil_id_hmac: string; civil_id_last4: string },
): boolean {
  try {
    const digits = civilIds.read(clinicId, row.id, row.civil_id_enc, null) ?? "";
    return (
      CIVIL_ID.test(digits) &&
      civilIds.index(clinicId, digits) === row.civil_id_hmac &&
      digits.slice(-4) === row.civil_id_last4
    );
  } catch {
    return false;
  }
}

/**
 * Proves one clinic is ready for the drop (R1-6): no plain number left, and every envelope opens with
 * this environment's keys to a number matching its index and last four digits. Reads only.
 *
 * @param deps the app pool and the codec
 * @param clinicId the clinic
 * @returns the counts
 */
export async function verifyClinicCivilIds(
  deps: BackfillDeps,
  clinicId: string,
): Promise<VerifyCounts> {
  const { db, civilIds } = deps;
  const plainRows = await db.withTenant(clinicId, (tx) =>
    tx.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM patients
          WHERE clinic_id = ${clinicId} AND civil_id IS NOT NULL`,
    ),
  );
  let encrypted = 0;
  let mismatched = 0;
  let after: string | null = null;
  for (;;) {
    const rows = await db.withTenant(clinicId, (tx) =>
      tx.execute<{
        id: string;
        civil_id_enc: string;
        civil_id_hmac: string;
        civil_id_last4: string;
      }>(
        sql`SELECT id, civil_id_enc, civil_id_hmac, civil_id_last4 FROM patients
            WHERE clinic_id = ${clinicId} AND civil_id_enc IS NOT NULL
              AND (${after}::uuid IS NULL OR id > ${after}::uuid)
            ORDER BY id LIMIT ${deps.batchSize ?? BATCH_SIZE}`,
      ),
    );
    if (rows.length === 0) return { plain: plainRows[0]?.n ?? 0, encrypted, mismatched };
    encrypted += rows.length;
    mismatched += rows.filter((row) => !isSound(civilIds, clinicId, row)).length;
    after = rows.at(-1)!.id;
  }
}
